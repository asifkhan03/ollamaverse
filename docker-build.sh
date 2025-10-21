cd ApplicationCode/frontend

docker build -t 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-frontend:3.3 .
docker push 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-frontend:3.3


cd ApplicationCode/backend
docker build -t 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-backend:3.3 .
docker push 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-backend:3.3



cd ApplicationCode/python
docker build -t 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-py-backend:3.4 .
docker push 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-py-backend:3.4


cd ApplicationCode/tokenapi
docker build -t 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-tokenapi:3.0 .
docker push 976193257685.dkr.ecr.ap-south-1.amazonaws.com/ollamaverse-tokenapi:3.0
