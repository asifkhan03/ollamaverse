package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"text/template"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Report struct {
	Name string
	URL  string
	Date string
}

func main() {
	bucketName := os.Getenv("S3_BUCKET")
	region := os.Getenv("AWS_REGION")

	if bucketName == "" || region == "" {
		log.Fatal("S3_BUCKET and AWS_REGION environment variables are required")
	}

	// Load AWS config
	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(region))
	if err != nil {
		log.Fatalf("Unable to load AWS SDK config: %v", err)
	}

	s3Client := s3.NewFromConfig(cfg)
	presigner := s3.NewPresignClient(s3Client)

	http.HandleFunc("/load-test", func(w http.ResponseWriter, r *http.Request) {
		reports, err := listReports(s3Client, presigner, bucketName)
		if err != nil {
			http.Error(w, "Failed to list reports: "+err.Error(), http.StatusInternalServerError)
			return
		}
		renderReports(w, reports)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Server running on port %s...", port)
	http.ListenAndServe(":"+port, nil)
}

func listReports(s3Client *s3.Client, presigner *s3.PresignClient, bucket string) ([]Report, error) {
	ctx := context.Background()
	resp, err := s3Client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket: aws.String(bucket),
	})
	if err != nil {
		return nil, err
	}

	var reports []Report
	for _, obj := range resp.Contents {
		if strings.HasSuffix(*obj.Key, ".html") {
			// Generate a pre-signed URL valid for 24 hours
			psURL, err := presigner.PresignGetObject(ctx, &s3.GetObjectInput{
				Bucket: aws.String(bucket),
				Key:    obj.Key,
			}, s3.WithPresignExpires(24*time.Hour))
			if err != nil {
				log.Printf("Error creating presigned URL for %s: %v", *obj.Key, err)
				continue
			}

			reports = append(reports, Report{
				Name: *obj.Key,
				URL:  psURL.URL,
				Date: obj.LastModified.Format("2006-01-02 15:04"),
			})
		}
	}

	// Sort latest first
	sort.Slice(reports, func(i, j int) bool {
		t1, _ := time.Parse("2006-01-02 15:04", reports[i].Date)
		t2, _ := time.Parse("2006-01-02 15:04", reports[j].Date)
		return t2.Before(t1)
	})

	return reports, nil
}

func renderReports(w http.ResponseWriter, reports []Report) {
	const html = `
	<html>
		<head>
			<title>Load Test Reports</title>
			<style>
				body { font-family: Arial, sans-serif; padding: 20px; }
				table { width: 100%; border-collapse: collapse; margin-top: 20px; }
				th, td { padding: 10px; border: 1px solid #ccc; text-align: left; }
				tr:hover { background-color: #f5f5f5; }
				a { color: #007bff; text-decoration: none; }
				a:hover { text-decoration: underline; }
			</style>
		</head>
		<body>
			<h2>📊 Load Test Reports</h2>
			<table>
				<tr><th>Date</th><th>Report</th></tr>
				{{range .}}
				<tr>
					<td>{{.Date}}</td>
					<td><a href="{{.URL}}" target="_blank">{{.Name}}</a></td>
				</tr>
				{{else}}
				<tr><td colspan="2">No reports found</td></tr>
				{{end}}
			</table>
		</body>
	</html>`
	tmpl := template.Must(template.New("reports").Parse(html))
	tmpl.Execute(w, reports)
}
