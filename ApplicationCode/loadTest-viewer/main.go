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

var (
	s3Client   *s3.Client
	s3Presign  *s3.PresignClient
	s3Bucket   string
	mongoURI   string
	redisURL   string
	mongoClient *mongo.Client
	redisClient *redis.Client
)

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

func main() {

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
		}
	}

	// Mongo Init
	if mongoURI != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		client, err := mongo.Connect(ctx, options.Client().ApplyURI(mongoURI))
		if err == nil && client.Ping(ctx, nil) == nil {
			mongoClient = client
			log.Println("Mongo connected")
		}
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
		}
	}

	// Routes
	http.HandleFunc("/load-test", loadTestHandler)
	http.HandleFunc("/db-data", dbDataHandler)
	http.HandleFunc("/db-data/collection", dbCollectionHandler)
	http.HandleFunc("/redis-data", redisDataHandler)
	http.HandleFunc("/redis-data/key", redisKeyHandler)

	log.Printf("Server running on %s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

/////////////////////////////////////////////////////////////
// S3 REPORT VIEWER
/////////////////////////////////////////////////////////////

func loadTestHandler(w http.ResponseWriter, r *http.Request) {
	if s3Client == nil || s3Presign == nil {
		http.Error(w, "S3 not configured", 500)
		return
	}

	reports, err := listReports(r.Context())
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	renderReports(w, reports)
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

		if !strings.HasSuffix(*obj.Key, ".html") {
			continue
		}

		ps, err := s3Presign.PresignGetObject(
			ctx,
			&s3.GetObjectInput{
				Bucket: aws.String(s3Bucket),
				Key:    obj.Key,
			},
			s3.WithPresignExpires(24*time.Hour),
		)
		if err != nil {
			continue
		}

		items = append(items, Report{
			Name: *obj.Key,
			URL:  ps.URL,
			Date: aws.ToTime(obj.LastModified),
		})
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].Date.After(items[j].Date)
	})

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

func renderReports(w http.ResponseWriter, reports []SimpleReportView) {
	const html = `
<!doctype html>
<html>
<body>
<h2>Load Test Reports</h2>
<ul>
{{range .}}
<li><a href="{{.URL}}">{{.Name}}</a> - {{.Date}}</li>
{{end}}
</ul>
</body>
</html>`
	tpl := template.Must(template.New("page").Parse(html))
	tpl.Execute(w, reports)
}

/////////////////////////////////////////////////////////////
// MONGO VIEWER
/////////////////////////////////////////////////////////////

func dbDataHandler(w http.ResponseWriter, r *http.Request) {

	if mongoClient == nil {
		http.Error(w, "Mongo not available", 500)
		return
	}

	ctx := context.Background()
	dbs, _ := mongoClient.ListDatabaseNames(ctx, bson.M{})

	var db string
	for _, d := range dbs {
		if d != "admin" && d != "local" && d != "config" {
			db = d
			break
		}
	}

	cols, _ := mongoClient.Database(db).ListCollectionNames(ctx, bson.M{})

	const html = `
<html><body>
<h2>MongoDB Collections ({{.DB}})</h2>
<ul>
{{range .Cols}}
<li><a href="/db-data/collection?name={{.}}">{{.}}</a></li>
{{end}}
</ul>
</body></html>`

	tpl := template.Must(template.New("db").Parse(html))
	tpl.Execute(w, map[string]interface{}{
		"DB":   db,
		"Cols": cols,
	})
}

func dbCollectionHandler(w http.ResponseWriter, r *http.Request) {

	if mongoClient == nil {
		http.Error(w, "Mongo not available", 500)
		return
	}

	name := r.URL.Query().Get("name")

	ctx := context.Background()

	dbs, _ := mongoClient.ListDatabaseNames(ctx, bson.M{})
	db := dbs[0]

	cur, _ := mongoClient.Database(db).Collection(name).
		Find(ctx, bson.M{}, options.Find().SetLimit(50))

	var docs []bson.M
	cur.All(ctx, &docs)

	out, _ := json.MarshalIndent(docs, "", "  ")
	fmt.Fprintf(w, "<pre>%s</pre>", string(out))
}

/////////////////////////////////////////////////////////////
// REDIS VIEWER
/////////////////////////////////////////////////////////////

func redisDataHandler(w http.ResponseWriter, r *http.Request) {

	if redisClient == nil {
		http.Error(w, "Redis not available", 500)
		return
	}

	ctx := context.Background()
	var cursor uint64
	var keys []string

	for {
		k, c, _ := redisClient.Scan(ctx, cursor, "*", 100).Result()
		cursor = c
		keys = append(keys, k...)
		if cursor == 0 {
			break
		}
	}

	const html = `
<html><body>
<h2>Redis Keys</h2>
<ul>
{{range .}}
<li><a href="/redis-data/key?key={{.}}">{{.}}</a></li>
{{end}}
</ul>
</body></html>`

	tpl := template.Must(template.New("redis").Parse(html))
	tpl.Execute(w, keys)
}

func redisKeyHandler(w http.ResponseWriter, r *http.Request) {

	if redisClient == nil {
		http.Error(w, "Redis not available", 500)
		return
	}

	key := r.URL.Query().Get("key")

	val, _ := redisClient.Get(context.Background(), key).Result()

	fmt.Fprintf(w, "<pre>%s</pre>", val)
}
