# purpose of this dockerfile is only to verify 
# that the script generally works in a minimal 
# environment which has latest node and yarn. 
# to test: 
# docker build -t test-canvas-downloader .  
# docker run --rm -it test-canvas-downloader node /canvas-downloader/lib/index.js --token "${CANVAS_TOKEN}" --url "${CANVAS_URL}" --dir /tmp --all


from node:19

WORKDIR /canvas-downloader

COPY . .

RUN yarn && yarn build 
