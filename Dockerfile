# Create binary package using node
FROM node:23-alpine3.20 AS build

WORKDIR /usr/app

COPY . .

RUN npm install && \
    npx esbuild run.js --bundle --outfile=build.cjs --format=cjs --platform=node && \
    npx pkg --targets latest-alpine-x64 build.cjs

# Create clean docker with just the needed binary and git
FROM alpine:3.20

ARG HOME_DIR=/usr/share/fee
ARG FEE_USER=fee

WORKDIR ${HOME_DIR}

COPY --from=build /usr/app/build fee

RUN apk add git && \
    addgroup -S ${FEE_USER} && \
    adduser -S ${FEE_USER} -G ${FEE_USER} -h ${HOME_DIR} && \
    chown -R ${FEE_USER}:${FEE_USER} ${HOME_DIR}

USER ${FEE_USER}

ENTRYPOINT ["./fee"]
