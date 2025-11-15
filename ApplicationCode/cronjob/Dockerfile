# # Use lightweight Python image
# FROM python:3.11-slim

# # Set working directory
# WORKDIR /app

# # Copy dependencies
# COPY requirements.txt .

# # Install dependencies
# RUN pip install --no-cache-dir -r requirements.txt

# # Copy the Python script
# COPY load_test.py .

# # Default command to run the script
# CMD ["python", "load_test.py"]


FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy Python and shell files
COPY load_test.py .
COPY run.sh .

# AWS CLI (needed for s3 upload)
RUN apt-get update && apt-get install -y awscli && apt-get clean

ENTRYPOINT ["./run.sh"]
