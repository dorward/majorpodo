FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS build
RUN npm install --global pnpm@12.16.1
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @majorpodo/scanner run build
RUN pnpm --filter @majorpodo/scanner deploy --prod /prod/scanner

FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS runtime
# Runtime starts node directly; package-manager tooling is only needed in build.
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-v* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /srv/app
COPY --from=build /prod/scanner ./
WORKDIR /srv/app/build
ENV MAJORPODO_CONFIGURATION_DIR=/configuration
CMD ["node", "index.js"]
