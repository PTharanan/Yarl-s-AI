FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json /app/
RUN npm ci

COPY . /app
RUN npm run build -- --configuration development

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/split-screen-app/browser /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]