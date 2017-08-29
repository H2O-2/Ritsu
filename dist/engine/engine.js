"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chalk = require("chalk");
const commandExist = require("command-exists");
const spawn = require("cross-spawn");
const fs = require("fs-extra");
const yaml = require("js-yaml");
const path = require("path");
const process = require("process");
const constants_1 = require("./constants");
const duplicateError_1 = require("./duplicateError");
const ejsParser_1 = require("./ejsParser");
const frontMatter_1 = require("./frontMatter");
const log_1 = require("./log");
/**
 * The Ritsu Engine, responsible for all operations of the static site generate.
 *
 * @export
 * @class Engine
 */
class Engine {
    constructor() {
        this.curTheme = constants_1.default.DEFAULT_THEME;
        this.engineRootPath = path.join(__dirname, '..' + path.sep + '..');
        this.initFilePath = path.join(this.engineRootPath, `init${path.sep}`);
        this.defaultSiteConfigPath = path.join(this.engineRootPath, constants_1.default.DEFAULT_SITE_CONFIG);
        this.defaultThemeConfigPath = path.join(this.engineRootPath, 'themes', constants_1.default.DEFAULT_THEME, constants_1.default.DEFAULT_THEME_CONFIG);
    }
    /**
     * Initialize an empty directory to a blog container.
     *
     * @returns {void}
     * @param {string} dirName
     * @memberof Engine
     */
    init(dirName) {
        if (!dirName)
            dirName = constants_1.default.DEFAULT_DIR_NAME;
        dirName += path.sep;
        this.rootPath = path.join(process.cwd(), dirName);
        this.initEngine(this.rootPath);
        const defaultThemePath = path.join(this.themePath, constants_1.default.DEFAULT_THEME, path.sep);
        let dbData;
        fs.pathExists(this.rootPath)
            .then((exists) => {
            if (exists)
                throw new duplicateError_1.default('A blog with the same name already exists here', dirName);
        })
            .then(() => log_1.default.logInfo('Initializing...'))
            .then(() => fs.copySync(this.initFilePath, this.rootPath))
            .then(() => fs.copySync(this.defaultThemeConfigPath, path.join(this.rootPath, constants_1.default.DEFAULT_THEME_CONFIG)))
            .then(() => this.defaultSiteConfig = yaml.safeLoad(fs.readFileSync(this.defaultSiteConfigPath, 'utf8')))
            .then(() => this.defaultThemeConfig = yaml.safeLoad(fs.readFileSync(this.defaultThemeConfigPath, 'utf8')))
            .then(() => dbData = {
            rootPath: this.rootPath,
            defaultSiteConfig: this.defaultSiteConfig,
            defaultThemeConfig: this.defaultThemeConfig,
            postData: [],
        })
            .then(() => fs.writeJSON(path.join(this.rootPath, constants_1.default.DB_FILE), dbData))
            .then(() => {
            // change working directory
            process.chdir(this.rootPath);
        })
            .then(() => this.newPost('ritsu', false))
            .then(() => log_1.default.logInfo('Fetching theme...'))
            .then(() => {
            if (commandExist.sync('git')) {
                spawn.sync('git', ['clone', constants_1.default.GIT_REPO_THEME_NOTES, defaultThemePath], { stdio: ['ignore', 'ignore', 'pipe'] });
            }
            else {
                throw new Error(`Git is not installed on your machine!\n\n` +
                    `Check ${chalk.underline('https://git-scm.com/book/en/v2/Getting-Started-Installing-Git')}` +
                    ` for the installation of git\n`);
            }
        })
            .then(() => log_1.default.logInfo('Blog successfully initialized! You can start writing :)'))
            .catch((e) => {
            log_1.default.logErr(e.message);
            this.abortGen(e, dirName);
            return;
        });
    }
    /**
     *
     * Create a new post inside posts folder.
     *
     * @param {string} postName
     * @param {boolean} [outputInfo=true]
     * @param {string} [templateName]
     * @memberof Engine
     */
    newPost(postName, outputInfo = true, templateName) {
        this.readDb()
            .then(() => this.updateConfig())
            .then(() => {
            if (fs.pathExistsSync(path.join(this.draftPath, `${postName}.md`)) || this.checkDuplicate(postName)) {
                throw new Error(`Duplicate post name ${chalk.cyan(postName)}.`);
            }
        })
            .then(() => {
            if (outputInfo)
                log_1.default.logInfo('Creating New Post...');
        })
            .then(() => {
            const postPosn = path.join(this.draftPath, `${postName}.md`);
            if (templateName) {
                const templatePosn = path.join(this.templatePath, `${templateName}.md`);
                if (fs.pathExistsSync(templatePosn)) {
                    fs.copySync(templatePosn, postPosn);
                }
                else {
                    throw new Error(`Template '${templateName}' does not exist`);
                }
            }
            else {
                const defaultTemplatePosn = path.join(this.templatePath, `${constants_1.default.DEFAULT_TEMPLATE}.md`);
                if (!fs.pathExistsSync(defaultTemplatePosn)) {
                    fs.copySync(path.join(this.initFilePath, 'templates', `${constants_1.default.DEFAULT_TEMPLATE}.md`), defaultTemplatePosn);
                }
                fs.copySync(defaultTemplatePosn, postPosn);
            }
        })
            .then(() => {
            if (outputInfo) {
                let newDraftPath = path.relative(process.cwd(), this.draftPath);
                if (process.cwd() === this.draftPath) {
                    newDraftPath = 'current directory';
                }
                log_1.default.logInfo(`New Post ${chalk.underline.black(postName)}` +
                    ` created at ${chalk.underline.black(`${newDraftPath}`)}.`);
                log_1.default.logInfo(`Run \`${chalk.blue('ritsu publish', postName)}\` when you finish writing.`);
            }
        })
            .catch((e) => log_1.default.logErr(e.message));
    }
    /**
     *
     * Delete the post from post directory and .db.json.
     *
     * @param {string} postName
     * @memberof Engine
     */
    delete(postName) {
        const postFile = `${postName}.md`;
        const dneError = new Error(`Post ${chalk.cyan(postName)} is either not published or does not exist.`);
        this.readDb()
            .then(() => {
            if (!fs.pathExistsSync(path.join(this.postPath, postFile))) {
                throw dneError;
            }
            else if (fs.pathExistsSync(path.join(this.trashPath, postFile))) {
                throw new Error(`A post with the same name already exists in directory` +
                    ` ${chalk.blue(path.relative(process.cwd(), this.trashPath))}.`);
            }
        })
            .then(() => log_1.default.logInfo('Deleting...'))
            .then(() => fs.move(path.join(this.postPath, postFile), path.join(this.trashPath, postFile)))
            .then(() => {
            const postDataArr = this.curDb.postData;
            for (let i = 0; i < postDataArr.length; i++) {
                if (postDataArr[i].fileName === postName) {
                    this.curDb.postData.splice(i, 1);
                    fs.writeJSONSync(path.join(this.rootPath, constants_1.default.DB_FILE), this.curDb);
                    return;
                }
            }
            throw dneError;
        })
            .then(() => log_1.default.logInfo(`Successfully deleted your post ${chalk.blue(postName)}, you can still find the post` +
            ` inside ${chalk.blue(path.relative(process.cwd(), this.trashPath))} folder.`))
            .then(() => log_1.default.logInfo(`If you want to restore the post, move it to` +
            ` ${chalk.blue(path.relative(process.cwd(), this.draftPath))} folder` +
            ` and publish it again`))
            .catch((e) => log_1.default.logErr(e.message));
    }
    /**
     *
     * Publish the post by moving the post to post directory and add data to .db.json.
     *
     * @param {string} postName
     * @param {string} [date]
     * @memberof Engine
     */
    publish(postName, date) {
        const postFile = `${postName}.md`;
        let draftPath;
        this.readDb()
            .then(() => this.updateConfig())
            .then(() => {
            draftPath = path.join(this.draftPath, postFile);
            if (!fs.pathExistsSync(draftPath)) {
                throw new Error(`Post ${chalk.blue(postName)} does not exist, check your post name.`);
            }
        })
            .then(() => log_1.default.logInfo('Processing...'))
            .then(() => fs.move(draftPath, path.join(this.postPath, postFile)))
            .then(() => frontMatter_1.default.parsePost(path.join(this.postPath, postFile)))
            .then((frontMatter) => {
            this.curDb.postData.push({ fileName: postName, title: frontMatter.title, date: Date.now() });
            fs.writeJSONSync(path.join(this.rootPath, constants_1.default.DB_FILE), this.curDb);
        })
            .then(() => log_1.default.logInfo(`Successfully published your post ${chalk.black.underline(postName)}.`))
            .then(() => log_1.default.logInfo(`Run \`${chalk.blue('ritsu generate')}\` to build your blog.`))
            .catch((e) => log_1.default.logErr(e.message));
    }
    /**
     *
     * Generate publish directory containing the full blog site in the root of blog directory.
     *
     * @param {string} [dirName]
     * @memberof Engine
     */
    generate(dirName) {
        let ejsParser;
        let generatePath;
        let generatePathRel;
        if (!dirName)
            dirName = constants_1.default.DEFAULT_GENERATE_DIR;
        this.readDb()
            .then(() => this.updateConfig())
            .then(() => generatePath = path.join(this.rootPath, dirName))
            .then(() => fs.pathExists(generatePath))
            .then((exists) => {
            generatePathRel = path.relative(process.cwd(), generatePath);
            if (exists)
                throw new duplicateError_1.default(`Directory ${chalk.underline.cyan(generatePathRel)} already exists.` +
                    ` Run \`${chalk.cyan('ritsu regenerate', dirName)}\` to regenerate blog or specify` +
                    ` another directory name.`, dirName);
        })
            .then(() => log_1.default.logInfo('Generating...'))
            .then(() => ejsParser = new ejsParser_1.default(path.join(this.themePath, constants_1.default.DEFAULT_THEME, constants_1.default.EJS_DIR), this.postPath, generatePath, this.customSiteConfig, this.customThemeConfig))
            .then(() => fs.mkdir(generatePath))
            .then(() => {
            fs.mkdirSync(path.join(generatePath, constants_1.default.RES_DIR));
        })
            .then(() => {
            const fileArr = [];
            for (const post of this.curDb.postData) {
                fileArr.push(post.fileName);
            }
            return fileArr;
        })
            .then((fileArr) => ejsParser.render(fileArr))
            .then(() => log_1.default.logInfo(`Blog successfully generated in ${chalk.underline.blue(generatePathRel)} directory!` +
            ` Run \`${chalk.blue('ritsu deploy')}\` to deploy blog.`))
            .catch((e) => {
            log_1.default.logErr(e.message);
            this.abortGen(e, generatePath);
        });
    }
    /**
     *
     * Check if postName already exists in .db.json
     *
     * @private
     * @param {string} postName
     * @returns {boolean}
     * @memberof Engine
     */
    checkDuplicate(postName) {
        const postDataArr = fs.readJsonSync(path.join(this.rootPath, constants_1.default.DB_FILE)).postData;
        for (const post of postDataArr) {
            if (post.fileName === postName)
                return true;
        }
        return false;
    }
    /**
     *
     * Read from site-config.yaml and theme-config.yaml file and update to newest custom configs.
     *
     * @private
     * @returns {Promise<void>}
     * @memberof Engine
     */
    updateConfig() {
        return fs.readFile(constants_1.default.DEFAULT_SITE_CONFIG, 'utf8')
            .then((siteConfigStr) => this.customSiteConfig = yaml.safeLoad(siteConfigStr))
            .then(() => fs.readFile(constants_1.default.DEFAULT_THEME_CONFIG, 'utf8'))
            .then((themeConfigStr) => this.customThemeConfig = yaml.safeLoad(themeConfigStr));
    }
    /**
     *
     * Find and read the .db.json file in root directory of blog
     *
     * @private
     * @returns {Promise<void>}
     * @memberof Engine
     */
    readDb() {
        return this.findDb(process.cwd())
            .then((data) => {
            if (!data.rootPath)
                throw new Error(`Please execute this command in blog directory or run` +
                    ` \`${chalk.cyan('ritsu init')}\` first`);
            this.rootPath = data.rootPath;
            this.defaultSiteConfig = data.defaultSiteConfig;
            this.defaultThemeConfig = data.defaultThemeConfig;
            this.curDb = data;
            this.initEngine(this.rootPath);
        });
    }
    /**
     *
     * Initialize fields of the engine.
     *
     * @private
     * @param {string} root
     * @memberof Engine
     */
    initEngine(root) {
        this.draftPath = path.join(root, 'drafts');
        this.postPath = path.join(root, 'posts');
        this.templatePath = path.join(root, 'templates');
        this.themePath = path.join(root, 'themes');
        this.trashPath = path.join(root, 'trash');
    }
    /**
     *
     * Inspired by hexo-cli: https://github.com/hexojs/hexo-cli
     *
     * Find .db.json file in current and parent directories.
     *
     * @private
     * @param {string} curPath
     * @returns {Promise<any>}
     * @memberof Engine
     */
    findDb(curPath) {
        const dbPath = path.join(curPath, constants_1.default.DB_FILE);
        return fs.pathExists(dbPath)
            .then((exists) => {
            if (exists) {
                const data = fs.readJSONSync(dbPath);
                return data;
            }
            else {
                const parent = path.dirname(curPath);
                if (parent === curPath)
                    return {};
                return this.findDb(parent);
            }
        })
            .catch((e) => log_1.default.logErr(e.message));
    }
    /**
     *
     * Delete files created during a failed operation.
     *
     * @private
     * @param {DuplicateError|Error} engineError
     * @param {string} dirName
     * @memberof Engine
     */
    abortGen(engineError, dirName) {
        fs.pathExists(this.rootPath)
            .then((exists) => {
            if (exists) {
                log_1.default.logPlain(chalk.bgRed.black('Reverting changes...'));
                if (!(engineError instanceof duplicateError_1.default))
                    spawn.sync('rm', ['-rf', dirName], { stdio: 'inherit' });
            }
        })
            .catch((e) => log_1.default.logErr(e.message));
    }
}
exports.default = Engine;
