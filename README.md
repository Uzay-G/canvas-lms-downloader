# Canvas LMS Course Data Downloader

This is a script for downloading the contents of course pages of a Canvas LMS instance to your machine.

It downloads all files, 'Pages', 'Announcements', and files linked to in "Modules" (since the files index for a course might throw 401 while the individual files might not).
It could be extended to download more content.

i update this whenever the script doesn't get all the things i want for a course. 

## Installation

```
# clone this repository
git clone https://github.com/Ysgorg/canvas-lms-downloader.git

# install dependencies and build
cd canvas-lms-downloader && yarn && yarn build
```

## Usage

You'll need an access token to the target Canvas LMS instance.
You can get generate one in your account settings in Canvas.

```bash
CANVAS_TOKEN="your canvas api token, retrieved through the canvas ui"
CANVAS_URL="https://canvas.vu.nl/api/v1/"
LOCAL_DATA_DIR="~/canvas" # where you want the downloaded data

# download for a specific course
node lib/index.js --token "${CANVAS_TOKEN}" --url "${CANVAS_URL}" --dir $LOCAL_DATA_DIR --course "Software Testing"

# download for all courses
node lib/index.js --token "${CANVAS_TOKEN}" --url "${CANVAS_URL}" --dir $LOCAL_DATA_DIR --all
```

Env vars can optionally be set using `direnv`. 
