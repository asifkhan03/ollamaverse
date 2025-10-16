# Stage 1: Use Nginx to serve static files
FROM nginx:alpine

# Copy your frontend files to nginx html directory
COPY . /usr/share/nginx/html
# Expose port 80 for web access
EXPOSE 80

# Start nginx automatically
CMD ["nginx", "-g", "daemon off;"]

