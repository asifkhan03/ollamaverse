aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin 976193257685.dkr.ecr.ap-south-1.amazonaws.com
cd ApplicationCode/frontend

docker buildx build --platform linux/arm64 -t 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-frontend:3.5 .
docker push 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-frontend:3.5


cd ApplicationCode/backend
docker buildx build --platform linux/arm64 -t 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-backend:3.6 .
docker push 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-backend:3.6



cd ApplicationCode/python
docker buildx build --platform linux/arm64 -t 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-py-backend:3.7 .
docker push 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-py-backend:3.7


cd ApplicationCode/tokenapi
docker buildx build --platform linux/arm64 -t 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-tokenapi:3.3 .
docker push 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-tokenapi:3.3

docker buildx build --platform linux/arm64 -t 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-loadtest:1.0 .
docker push 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-loadtest:1.0

docker buildx build --platform linux/arm64 -t 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-loadtest-viewer:1.3 .
docker push 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-loadtest-viewer:1.3

 docker buildx build --platform linux/arm64 -t 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-loadtest-cron:1.7 .
 docker push 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-loadtest-cron:1.7