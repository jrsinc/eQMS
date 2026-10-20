FROM node:22.14-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/data
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
RUN useradd --system --uid 10001 qms && mkdir -p /data && chown qms /data
USER qms
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
