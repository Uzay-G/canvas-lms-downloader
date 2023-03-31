import request from 'superagent';
import fs from 'fs-extra';
import path from 'path';
import { program } from 'commander';
import filenamify from "filenamify";
import lodash from 'lodash';



program
  .option('-c --course [course]', "Course to download (name or code)", String)
  .option('-a --all [all]', 'Get all courses', Boolean)
  .option('-d --dir <to>', 'Location to download to', String)
  .option('-u --url <url>', 'Canvas API URL', String)
  .option('-t --token <token>', 'Canvas API token', String)
  .parse(process.argv);

function commanderFail(message: string) {
  if (message) console.error(message);
  program.help()
}

const options = program.opts();

if (options.course && options.all) {
  commanderFail("Specify either --course or --all, not both");
}
if (!options.course && !options.all) {
  commanderFail("Must specify either --course or --all");
}
for (const key of ['dir', 'url', 'token']) {
  if (!options[key]) {
    commanderFail(`Must specify ${key}`);
  }
}

function santizeFilename(s:string){
  return filenamify(s).replace(/\s/g,'_')
}
// would be safer to use pagination, but most courses probably dont have more files,pages or announcments than this
const PAGE_SIZE = 999999;

interface Course {
  id: number,
  name: string,
  course_code:string
}

interface File {
  folder_id: number,
  filename: string,
  url: string, // link to download actual bytes of files
  modified_at: string, // timestamp
}

interface Folder {
  id: number,
  full_name: string // folder path relative to course/<id>/files
}

interface Page {
  url: string;
  updated_at: string;
}

interface Announcement {
  id:string;
  title:string;
  created_at: string;
  message:string;
}

interface Module {
  id: number,
  name: string,
  position: number,
  unlock_at: null|any,
  require_sequential_progress: boolean,
  publish_final_grade: boolean,
  prerequisite_module_ids: Array<any>,
  state: 'completed'|string,
  completed_at: string, // iso date string
  items_count: number,
  items_url: string;
}
interface ModuleItem  {
    id: number,
    title: string,
    position: number,
    indent: number,
    type: 'Assignment'|string,
    module_id: number,
    html_url: string,
    content_id: number,
    url: string;
  }


async function fIfNeeded(f:()=>Promise<void>, destPath:string, mtime:Date){
  // check if a file already exists at destPath and has a certain last modified time.
  // if not, then execute the passed function. which should cause a file to be created at destPath.
  // then the modification time applied to the newly created file.
  if ((await fs.pathExists(destPath)) && mtime.getTime() === (await fs.stat(destPath)).mtime.getTime()) {
    console.info(`[SKIP] ${destPath}`);
    return;
  }
  else await f();
  console.info(`[WRITE] ${destPath}`);
  await fs.utimes(destPath, new Date(), mtime);
}

async function getJson(url: string, query = {}) {
  query = {per_page:PAGE_SIZE, ...query};
  const response = await request
    .get(url)
    .set('Authorization', `Bearer ${options.token}`)
    .set("Accept", 'application/json')
    .query(query)
    .catch(e => {
      console.error(`[${e.response.header.status}] ${url} query:${JSON.stringify(query)}`);
    });
  if (response) return response.body;
}

async function downloadFiles(c: Course, courseDir: string) {
  // files are flat, folders data needed to replicate canvas folder structure
  const folders = await getJson(`${options.url}/courses/${c.id}/folders`) as Folder[];
  if (!folders) return;

  // get list of files from canvas
  const files = await getJson(`${options.url}/courses/${c.id}/files`) as File[];
  if (!files) return;

  // sort by date with most recently modified first
  const sortedFiles = (files).sort((a, b) => new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime())
  // remove files with duplicate paths, keeping the most recently modified in case of conflict (guaranteed due to sort direction)
  const uniqueFiles = lodash.uniqBy(sortedFiles, f => `${f.folder_id} ${f.filename}`);

  for (const file of uniqueFiles) {
    const canvasFoldername = folders.find(f => f.id === file.folder_id).full_name;
    const santizedCanvasFoldername = path.resolve(courseDir, ...canvasFoldername.split('/').map(n => santizeFilename(n)));
    const folder = path.resolve(courseDir, santizedCanvasFoldername);
    await fs.mkdirs(folder)
    const destPath = path.resolve(folder, file.filename);

    await fIfNeeded(
      ()=>new Promise((resolve, reject) => {
        var stream = fs.createWriteStream(destPath);
        stream.on('finish',resolve);
        stream.on('error', reject)
        request.get(file.url)
          .set('Authorization', `Bearer ${options.token}`)
          .pipe(stream);
      }),
      destPath,
      new Date(file.modified_at)
    )
  }
}
async function downloadModules(c: Course, courseDir: string) {
  // files are flat, folders data needed to replicate canvas folder structure
  const modules = await getJson(`${options.url}/courses/${c.id}/modules`) as Module[];
  for (let module of modules){

    const canvasFoldername = `modules/${module.name}`//folders.find(f => f.id === file.folder_id).full_name;
    const santizedCanvasFoldername = path.resolve(courseDir, ...canvasFoldername.split('/').map(n => santizeFilename(n))).replace(/\s/g,'_');
    const folder = path.resolve(courseDir, santizedCanvasFoldername);
    await fs.mkdirs(folder)

    const items = await getJson(module.items_url) as ModuleItem[];
    for (let item of items){

      if (!item.url) continue; 

      // this can be any of a number of different interfaces.
      // it might contain a download link for a file which is not available under the /files api
      const thing = await getJson(item.url)

      if (!thing.url||!thing.filename) continue;
      const destPath = path.resolve(folder, thing.filename);


      await fIfNeeded(
        ()=>new Promise((resolve, reject) => {
          var stream = fs.createWriteStream(destPath);
          stream.on('finish', resolve);
          stream.on('error', reject)
          request.get(thing.url)
            .set('Authorization', `Bearer ${options.token}`)
            .pipe(stream);
        }),
        destPath,
        new Date(thing.modified_at)
      )
    }
  }
}


async function downloadPages(c: Course, courseDir: string) {
  const pages = await getJson(`${options.url}/courses/${c.id}/pages`) as Page[];
  if (!pages) return;
  const pagesDir = path.resolve(courseDir, 'pages');
  await fs.mkdirp(pagesDir);
  for (const page of pages) {
    const destPath = path.resolve(pagesDir, santizeFilename(page.url) + ".html");
    await fIfNeeded(async ()=>{
      const r = await request.get(`${options.url}/courses/${c.id}/pages/${page.url}`).query({ per_page: PAGE_SIZE }).set("Authorization", `Bearer ${options.token}`);
      const pageData = r.body;
      await fs.writeFile(destPath, pageData.body)},
      destPath,
      new Date(page.updated_at)
    )
  }
}
async function downloadAnnouncements(c: Course, courseDir: string) {
  const announcements = await getJson(`${options.url}/announcements`, { 'context_codes[]': `course_${c.id}` }) as Announcement[];
  if (!announcements) return;
  const announcementsDir = path.resolve(courseDir, 'announcements');
  await fs.mkdirp(announcementsDir)
  for (const a of announcements) {
    const canvasMtime = new Date(a.created_at);
    const destPath = path.resolve(announcementsDir, santizeFilename(a.title + '_' + a.id) + '.html');
    await fIfNeeded(()=>fs.writeFile(destPath, a.message),destPath,canvasMtime)
  }
}

async function run() {

  const courseName = options.course;
  const targetFolder = options.dir;

  const courses = await getJson(`${options.url}/courses`, {per_page:PAGE_SIZE}) as Course[];
  if (!courses) return;
  const coursesToProcess = courseName ? courses.filter(a => a.name === courseName || a.course_code === courseName) : courses;
  if (!coursesToProcess) {
    console.info("Found no courses to download");
    return;
  }

  await fs.mkdirp(targetFolder);

  for (const c of coursesToProcess) {
    
    if (!c.name){
      console.info("No course name, skipping. Data:", JSON.stringify(c));
      continue;
    }

    console.info(`\n> Downloading from ${c.course_code} ${c.name}`);

    const courseDir = path.resolve(targetFolder, santizeFilename(c.name)+"_"+c.id);
    await fs.mkdirp(courseDir);

    await downloadFiles(c, courseDir).catch(console.error);
    await downloadPages(c, courseDir).catch(console.error);
    await downloadAnnouncements(c, courseDir).catch(console.error);
    await downloadModules(c, courseDir).catch(console.error);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
})
