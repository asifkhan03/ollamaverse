package main

import (
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// --------- globals ----------
var (
	s3Client    *s3.Client
	s3Presign   *s3.PresignClient
	s3Bucket    string
	mongoURI    string
	redisURL    string
	mongoClient *mongo.Client
	redisClient *redis.Client
)

// --------- types ----------
type Report struct {
	Name string
	URL  string
	Date time.Time
}

type SimpleReportView struct {
	Name string
	URL  string
	Date string
}

type ColView struct {
	Name     string
	RowCount int64
	Sample   string // preformatted JSON (escaped)
}

// --------- layout helper ----------
// layout returns a full HTML page string with a sidebar and content placeholder.
// content may include Go template directives (e.g. {{range .}}) — they'll be parsed later.
func layout(title string, content string) string {
	return fmt.Sprintf(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>%s</title>
  <style>
    :root {
      --bg: #f4f6fa;
      --card: #ffffff;
      --muted: #6b7280;
      --primary: #0b63f6;
      --shadow: 0 6px 24px rgba(2,6,23,0.08);
    }
    html,body { height:100%%; margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; background:var(--bg); color:#0f172a; }
    .app { display:flex; height:100vh; overflow:hidden; }
    .sidebar {
      width: 240px;
      background: #071028;
      color: #e6eef8;
      padding: 20px;
      box-sizing: border-box;
      flex-shrink:0;
      display:flex;
      flex-direction:column;
    }
    .brand { font-weight:700; font-size:18px; margin-bottom:18px; }
    .nav { display:flex; flex-direction:column; gap:6px; }
    .nav a {
      color: #cfe6ff;
      text-decoration:none;
      padding: 10px 12px;
      border-radius:8px;
      display:block;
      font-size:15px;
    }
    .nav a.active, .nav a:hover { background:#04243f; color:white; }
    .content {
      flex:1;
      padding: 28px;
      overflow:auto;
    }
    .card {
      background: var(--card);
      padding: 20px;
      border-radius: 12px;
      box-shadow: var(--shadow);
      max-width: 1200px;
      margin: 0 auto;
    }
    h1,h2 { margin:0 0 12px 0; }
    .row { display:flex; gap:12px; align-items:center; margin-bottom:12px; }
    .search {
      width:100%%;
      padding:10px 12px;
      border-radius:8px;
      border:1px solid #e6eef8;
      box-sizing:border-box;
      font-size:15px;
    }
    .list { margin-top:12px; display:block; }
    .list-item {
      padding:12px;
      border-radius:8px;
      background:#f3f6fb;
      margin-bottom:8px;
      display:flex;
      justify-content:space-between;
      align-items:center;
      word-break:break-all;
    }
    .list-item a { color:var(--primary); font-weight:600; text-decoration:none; }
    .badge { background:var(--primary); color:white; padding:6px 10px; border-radius:999px; font-size:13px; }
    pre.json {
      background: #0f1724;
      color: #dbeafe;
      padding: 14px;
      border-radius:8px;
      overflow:auto;
      font-size:13px;
      line-height:1.45;
      white-space:pre-wrap;
      word-break:break-word;
    }
    .copy-btn {
      background:var(--primary);
      color:white;
      border:none;
      padding:8px 12px;
      border-radius:8px;
      cursor:pointer;
      font-weight:600;
      margin-left:8px;
    }
    @media (max-width:900px) {
      .sidebar { display:none; }
      .app { flex-direction:column; }
      .content { padding:12px; height:100vh; overflow:auto; }
      .card { margin:0; border-radius:0; box-shadow:none; }
    }
  </style>

  <script>
    function copyTextById(id) {
      try {
        var t = document.getElementById(id).innerText;
        navigator.clipboard.writeText(t);
        alert("Copied to clipboard");
      } catch(e){
        alert("Copy failed");
      }
    }

    function filterList(inputId, itemClass) {
      var q = document.getElementById(inputId).value.toLowerCase();
      var items = document.getElementsByClassName(itemClass);
      for (var i=0;i<items.length;i++){
        var txt = items[i].innerText || items[i].textContent;
        if (txt.toLowerCase().indexOf(q) !== -1) {
          items[i].style.display = "";
        } else {
          items[i].style.display = "none";
        }
      }
    }
  </script>
</head>
<body>
  <div class="app">
    <div class="sidebar">
      <div class="brand">AIOps Studio</div>
      <div style="font-size:13px;color:#9fb7d6;margin-bottom:12px">Observability & Tools</div>
      <div class="nav">
        <a href="/load-test" id="nav-load">📊 Load Test Reports</a>
        <a href="/db-data" id="nav-db">🗄 MongoDB Viewer</a>
        <a href="/redis-data" id="nav-redis">⚡ Redis Viewer</a>
      </div>
      <div style="flex:1"></div>
      <div style="font-size:12px;color:#7f8ea3">Server UI · Built-in</div>
    </div>

    <div class="content">
      %s
    </div>
  </div>
</body>
</html>`, template.HTMLEscapeString(title), content)
}

// --------- main ----------
func main() {
	// envs
	s3Bucket = os.Getenv("S3_BUCKET")
	region := os.Getenv("AWS_REGION")
	mongoURI = os.Getenv("DATABASE_URL")
	redisURL = os.Getenv("REDIS_URL")
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// AWS Init
	if region != "" {
		cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(region))
		if err == nil {
			s3Client = s3.NewFromConfig(cfg)
			s3Presign = s3.NewPresignClient(s3Client)
			log.Println("AWS S3 initialized")
		} else {
			log.Printf("AWS config error: %v", err)
		}
	} else {
		log.Println("AWS_REGION not set — S3 features disabled")
	}

	// Mongo Init
	if mongoURI != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		client, err := mongo.Connect(ctx, options.Client().ApplyURI(mongoURI))
		if err != nil {
			log.Printf("Mongo connect error: %v", err)
		} else if err == nil && client.Ping(ctx, nil) == nil {
			mongoClient = client
			log.Println("Mongo connected")
		} else {
			log.Printf("Mongo ping error: %v", err)
		}
	} else {
		log.Println("DATABASE_URL not set — Mongo disabled")
	}

	// Redis Init
	if redisURL != "" {
		opt, err := redis.ParseURL(redisURL)
		if err != nil {
			opt = &redis.Options{Addr: redisURL}
		}
		rdb := redis.NewClient(opt)
		if rdb.Ping(context.Background()).Err() == nil {
			redisClient = rdb
			log.Println("Redis connected")
		} else {
			log.Println("Redis ping failed")
		}
	} else {
		log.Println("REDIS_URL not set — Redis disabled")
	}

	// routes
	http.HandleFunc("/load-test", loadTestHandler)
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// default redirect to load-test
		http.Redirect(w, r, "/load-test", http.StatusFound)
	})
	http.HandleFunc("/db-data", dbDataHandler)
	http.HandleFunc("/db-data/collection", dbCollectionHandler)
	http.HandleFunc("/redis-data", redisDataHandler)
	http.HandleFunc("/redis-data/key", redisKeyHandler)

	log.Printf("Server running on port %s...", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

/////////////////////////////////////////////////////////////
// S3 / Load test reports
/////////////////////////////////////////////////////////////

func loadTestHandler(w http.ResponseWriter, r *http.Request) {
	if s3Client == nil || s3Presign == nil {
		// render a friendly notice (so UI still loads)
		content := `<div class="card"><h2>📊 Load Test Reports</h2><p style="color:#6b7280">S3 not configured or AWS credentials missing. Set <code>S3_BUCKET</code> and <code>AWS_REGION</code> or enable IRSA.</p></div>`
		page := layout("Load Test Reports", content)
		fmt.Fprint(w, page)
		return
	}

	reports, err := listReports(r.Context())
	if err != nil {
		http.Error(w, "Failed to list reports: "+err.Error(), 500)
		return
	}

	// prepare content template with template actions
	content := `
<div class="card">
  <h2>📊 Load Test Reports</h2>

  <div class="row">
    <input id="reportSearch" class="search" placeholder="Filter reports..." onkeyup="filterList('reportSearch','rItem')"/>
  </div>

  <div class="list">
  {{range .}}
    <div class="list-item rItem">
      <div><a href="{{.URL}}" target="_blank">{{.Name}}</a></div>
      <div class="badge">{{.Date}}</div>
    </div>
  {{end}}
  </div>
</div>
`
	tpl := template.Must(template.New("reports").Parse(layout("Load Test Reports", content)))
	tpl.Execute(w, reports)
}

func listReports(ctx context.Context) ([]SimpleReportView, error) {
	resp, err := s3Client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket: aws.String(s3Bucket),
	})
	if err != nil {
		return nil, err
	}
	var items []Report
	for _, obj := range resp.Contents {
		if strings.HasSuffix(*obj.Key, ".html") {
			ps, err := s3Presign.PresignGetObject(ctx, &s3.GetObjectInput{
				Bucket: aws.String(s3Bucket),
				Key:    obj.Key,
			}, s3.WithPresignExpires(24*time.Hour))
			if err != nil {
				log.Printf("presign error %v", err)
				continue
			}
			items = append(items, Report{
				Name: *obj.Key,
				URL:  ps.URL,
				Date: aws.ToTime(obj.LastModified),
			})
		}
	}

	// sort latest first
	sort.Slice(items, func(i, j int) bool { return items[i].Date.After(items[j].Date) })

	var out []SimpleReportView
	for _, r := range items {
		out = append(out, SimpleReportView{
			Name: r.Name,
			URL:  r.URL,
			Date: r.Date.Format("2006-01-02 15:04"),
		})
	}
	return out, nil
}

/////////////////////////////////////////////////////////////
// Mongo viewer
/////////////////////////////////////////////////////////////

func dbDataHandler(w http.ResponseWriter, r *http.Request) {
	if mongoClient == nil {
		content := `<div class="card"><h2>MongoDB Collections</h2><p style="color:#6b7280">MongoDB not configured or unreachable. Set DATABASE_URL or check network access.</p></div>`
		page := layout("MongoDB Collections", content)
		fmt.Fprint(w, page)
		return
	}

	ctx := context.Background()
	dbs, err := mongoClient.ListDatabaseNames(ctx, bson.M{})
	if err != nil || len(dbs) == 0 {
		content := `<div class="card"><h2>MongoDB Collections</h2><p style="color:#6b7280">No databases found or failed to list databases.</p></div>`
		page := layout("MongoDB Collections", content)
		fmt.Fprint(w, page)
		return
	}

	// pick first non-system DB
	var dbName string
	for _, d := range dbs {
		if d != "admin" && d != "local" && d != "config" {
			dbName = d
			break
		}
	}
	if dbName == "" {
		dbName = dbs[0]
	}

	cols, err := mongoClient.Database(dbName).ListCollectionNames(ctx, bson.M{})
	if err != nil {
		content := `<div class="card"><h2>MongoDB Collections</h2><p style="color:#6b7280">Failed to list collections: ` + template.HTMLEscapeString(err.Error()) + `</p></div>`
		page := layout("MongoDB Collections", content)
		fmt.Fprint(w, page)
		return
	}

	// build ColView slice with counts (estimated)
	var colViews []ColView
	for _, c := range cols {
		cnt, _ := mongoClient.Database(dbName).Collection(c).EstimatedDocumentCount(ctx)
		colViews = append(colViews, ColView{
			Name:     c,
			RowCount: cnt,
		})
	}

	// content template with Go template actions
	content := `
<div class="card">
  <h2>📦 MongoDB Collections ({{.DB}})</h2>
  <div class="row">
    <input id="mongoSearch" class="search" placeholder="Filter collections..." onkeyup="filterList('mongoSearch','mItem')"/>
  </div>

  <div class="list">
    {{range .Cols}}
      <div class="list-item mItem">
        <div><a href="/db-data/collection?name={{.Name}}">{{.Name}}</a></div>
        <div class="badge">{{.RowCount}}</div>
      </div>
    {{end}}
  </div>
</div>
`

	tpl := template.Must(template.New("db").Parse(layout("MongoDB Collections", content)))
	tpl.Execute(w, map[string]interface{}{
		"DB":   dbName,
		"Cols": colViews,
	})
}

func dbCollectionHandler(w http.ResponseWriter, r *http.Request) {
	if mongoClient == nil {
		content := `<div class="card"><h2>Collection</h2><p style="color:#6b7280">Mongo not configured.</p></div>`
		page := layout("Collection", content)
		fmt.Fprint(w, page)
		return
	}

	name := r.URL.Query().Get("name")
	if name == "" {
		http.Error(w, "missing collection name", 400)
		return
	}

	ctx := context.Background()
	dbs, _ := mongoClient.ListDatabaseNames(ctx, bson.M{})
	if len(dbs) == 0 {
		http.Error(w, "no dbs", 500)
		return
	}
	dbName := dbs[0]

	cur, err := mongoClient.Database(dbName).Collection(name).Find(ctx, bson.M{}, options.Find().SetLimit(200))
	if err != nil {
		content := `<div class="card"><h2>Collection: ` + template.HTMLEscapeString(name) + `</h2><p style="color:#6b7280">` + template.HTMLEscapeString(err.Error()) + `</p></div>`
		page := layout("Collection", content)
		fmt.Fprint(w, page)
		return
	}
	var docs []bson.M
	if err := cur.All(ctx, &docs); err != nil {
		content := `<div class="card"><h2>Collection: ` + template.HTMLEscapeString(name) + `</h2><p style="color:#6b7280">failed to read docs</p></div>`
		page := layout("Collection", content)
		fmt.Fprint(w, page)
		return
	}

	jb, _ := json.MarshalIndent(docs, "", "  ")
	escaped := template.HTMLEscapeString(string(jb))

	content := fmt.Sprintf(`
<div class="card">
  <h2>📁 Collection: %s (sample %d rows)</h2>
  <div style="margin-bottom:10px">
    <button class="copy-btn" onclick="copyTextById('jsonData')">Copy JSON</button>
  </div>
  <pre id="jsonData" class="json">%s</pre>
</div>
`, template.HTMLEscapeString(name), len(docs), escaped)

	page := layout("Collection: "+name, content)
	fmt.Fprint(w, page)
}

/////////////////////////////////////////////////////////////
// Redis viewer
/////////////////////////////////////////////////////////////

func redisDataHandler(w http.ResponseWriter, r *http.Request) {
	if redisClient == nil {
		content := `<div class="card"><h2>Redis Keys</h2><p style="color:#6b7280">Redis not configured or unreachable.</p></div>`
		page := layout("Redis Keys", content)
		fmt.Fprint(w, page)
		return
	}

	ctx := context.Background()
	var cursor uint64
	var keys []string

	for {
		k, c, err := redisClient.Scan(ctx, cursor, "*", 200).Result()
		if err != nil {
			log.Printf("redis scan error: %v", err)
			break
		}
		keys = append(keys, k...)
		cursor = c
		if cursor == 0 {
			break
		}
		if len(keys) >= 1000 {
			keys = keys[:1000]
			break
		}
	}

	// content template that uses range over keys (strings)
	content := `
<div class="card">
  <h2>⚡ Redis Keys</h2>
  <div class="row">
    <input id="redisSearch" class="search" placeholder="Search keys..." onkeyup="filterList('redisSearch','rItem')"/>
  </div>

  <div class="list">
    {{range .}}
      <div class="list-item rItem">
        <div><a href="/redis-data/key?key={{.}}">{{.}}</a></div>
      </div>
    {{end}}
  </div>
</div>
`

	tpl := template.Must(template.New("redis").Parse(layout("Redis Keys", content)))
	tpl.Execute(w, keys)
}

func redisKeyHandler(w http.ResponseWriter, r *http.Request) {
	if redisClient == nil {
		content := `<div class="card"><h2>Redis Key</h2><p style="color:#6b7280">Redis not configured.</p></div>`
		page := layout("Redis Key", content)
		fmt.Fprint(w, page)
		return
	}

	key := r.URL.Query().Get("key")
	if key == "" {
		http.Error(w, "missing key param", 400)
		return
	}

	ctx := context.Background()
	kt, _ := redisClient.Type(ctx, key).Result()
	var body string
	switch kt {
	case "string":
		v, _ := redisClient.Get(ctx, key).Result()
		body = template.HTMLEscapeString(v)
	case "list":
		v, _ := redisClient.LRange(ctx, key, 0, 200).Result()
		bs, _ := json.MarshalIndent(v, "", "  ")
		body = template.HTMLEscapeString(string(bs))
	case "hash":
		v, _ := redisClient.HGetAll(ctx, key).Result()
		bs, _ := json.MarshalIndent(v, "", "  ")
		body = template.HTMLEscapeString(string(bs))
	case "set":
		v, _ := redisClient.SMembers(ctx, key).Result()
		bs, _ := json.MarshalIndent(v, "", "  ")
		body = template.HTMLEscapeString(string(bs))
	case "zset":
		v, _ := redisClient.ZRangeWithScores(ctx, key, 0, 200).Result()
		bs, _ := json.MarshalIndent(v, "", "  ")
		body = template.HTMLEscapeString(string(bs))
	default:
		body = "(type not handled or empty)"
	}

	content := fmt.Sprintf(`
<div class="card">
  <h2>🔑 Key: %s</h2>
  <div style="margin-bottom:10px">
    <button class="copy-btn" onclick="copyTextById('redisJson')">Copy</button>
  </div>
  <pre id="redisJson" class="json">%s</pre>
</div>
`, template.HTMLEscapeString(key), body)

	page := layout("Redis Key: "+key, content)
	fmt.Fprint(w, page)
}
