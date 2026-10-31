FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS build
RUN npm install --global pnpm@12.16.1
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @majorpodo/http run build
RUN pnpm --filter @majorpodo/http deploy --prod /prod/http

FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS runtime
# Runtime starts node directly; package-manager tooling is only needed in build.
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-v* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /srv/app
COPY --from=build /prod/http ./
ENV MAJORPODO_CONFIGURATION_DIR=/configuration
EXPOSE 3000
CMD ["node", "build/index.js"]
