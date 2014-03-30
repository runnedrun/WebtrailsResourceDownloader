AWS = require('aws-sdk');
//AWS.config.loadFromPath('./aws_config.json');
AWS.config.update({accessKeyId: process.env.AWS_KEY, secretAccessKey: process.env.AWS_SECRET});
awsBucket = new AWS.S3({params: {Bucket: 'TrailsSitesProto'}});

console.log("db url is", process.env.DATABASE_URL);

var pg = require('pg');
var request = require('request');
var url = require('url');

function absoluteAwsUrl(path) {
    var encodedPath = path.split("/").map(function(sect){ return encodeURIComponent(sect) }).join("/");
    return "https://s3.amazonaws.com/TrailsSitesProto/" + encodedPath
}

function generateArchivePath(path, revisionNumber) {
    return path[path.length-1] == "/" ? path + revisionNumber : path + "/" + revisionNumber;
}

exports.resourceDownloader = function(req, res){
    console.log("in the resource downloader");

    var auth_token = req.headers["WT_AUTH_TOKEN"] || req.cookies.wt_auth_token

    console.log("auth_token is: " + auth_token);

    if (auth_token){
        var archiveBase = false;
        var archivePath = false;
        var resp;

        if (req.body.html.awsPath){
            archiveBase = absoluteAwsUrl(req.body.html.awsPath)
            archivePath = generateArchivePath(req.body.html.awsPath, req.body.revision);
            resp = { archive_location: absoluteAwsUrl(archivePath)};
        } else {
            resp = {}
        }

        new Site(req.body.siteID, auth_token, function(site) {
            new ResourceHandler(req, site, archivePath, archiveBase);
        });

        res.setHeader("Access-Control-Allow-Origin", "*");
        res.send(resp);
    } else {
        res.send('not authorized for that operation', 404);
    }
};

ResourceHandler = function(req, site, archivePath, archiveBase) {
    var siteId = req.body.siteID;
    var resources = req.body.originalToAwsUrlMap || [];
    var stylesheets= req.body.styleSheets || [];
    var html = req.body.html;
    var isIframe = req.body.isIframe;
    var revisionNumber = req.body.revision;
    var isBaseRevision = req.body.isBaseRevision;

    var callbackTracker = new CallbackTracker(Object.keys(resources).length, Object.keys(stylesheets).length, function() {
        console.log("is iframe?", isIframe, typeof isIframe);
        if (isIframe == "false") {
            console.log("archive location is: " + site.archiveLocation);
            console.log("now updating the site");
            site.revisionNumbers.push(revisionNumber);
            if (isBaseRevision == "true") site.baseRevisionNumber = parseInt(revisionNumber);
            site.updateSiteInDb();
        }
    });

    console.log('in the resource handler');

    function mirrorResource(resourceUrl, mirrorPath) {
        var requestOptions = {
            uri: resourceUrl,
            encoding: null
        }
        request(requestOptions, function(error, response, body) {
            if (!error && response.statusCode == 200) {
                putDataOns3(mirrorPath, body, response.headers["content-type"], function() {
                    site.savedResources.push(resourceUrl);
                    callbackTracker.markResourceAsSaved(resourceUrl);
                });
            } else {
                console.log("error downloading from: " + resourceUrl);
                if (error) console.log("error is: " + error.message);
//                console.log("status code is: " + response.statusCode);
                callbackTracker.markResourceAsSaved();
            }
        })
    }

    function putDataOns3(path, data, contentType, callback) {
        var params = {Key: path, Body: data, ACL: "public-read", CacheControl: "max-age=157680000, public" };
        if (contentType) {
            params["ContentType"] = contentType;
        }
        awsBucket.putObject(params, function(err, data) {
            if (err) {
                console.log("Error uploading data for path: "  + path + ", err: " + err);
            } else {
                console.log("Successfully uploaded to: " + absoluteAwsUrl(path));
            }
            callback(data);
        })
    }

    for ( var path in stylesheets ) {
        if (site.savedStylesheets.indexOf(path) == -1) {
            putDataOns3(path, stylesheets[path], "text/css", function(path) {
                return function() {
                    site.savedStylesheets.push(path);
                    callbackTracker.markStylesheetAsSaved();
                }
            }(path));
        } else {
            console.log("stylesheet already saved, skipping");
            callbackTracker.markStylesheetAsSaved();
        }
    }

    for ( var resourceUrl in resources ) {
        if (site.savedResources.indexOf(resourceUrl) == -1) {
            mirrorResource(resourceUrl, resources[resourceUrl]);
        } else {
            console.log("resource already saved, skipping");
            callbackTracker.markResourceAsSaved();
        }
    }

    console.log("archive location is: " + site.archiveLocation);

    if (archiveBase && archivePath){
        site.archiveLocation = archiveBase
    } else {
        archivePath = url.parse(site.archiveLocation).pathname.replace(/\/TrailsSitesProto(\/)?/,"") + "/" + revisionNumber;
    }

    callbackTracker.setSaveHtmlFunction(function(callback) {
        putDataOns3(archivePath, html.html, "text/html", function() {
            callback();
        });
    })
}


// Waits for all resources to be downloaded before saving the full html and
// calling the given callback.
CallbackTracker = function(resourcesRemaining, stylesheetsRemaining, callback) {
    var htmlSaveFunction = false;

    this.markResourceAsSaved = function() {
        resourcesRemaining -= 1;
        checkIfMirroringIsComplete();
    };

    this.markStylesheetAsSaved = function() {
        stylesheetsRemaining -= 1;
        checkIfMirroringIsComplete();
    };

    this.setSaveHtmlFunction = function(fn) {
        htmlSaveFunction = fn;
        checkIfMirroringIsComplete();
    };

    function checkIfMirroringIsComplete() {
        console.log("stylesheets remaining is:" + stylesheetsRemaining);
        console.log("resources remaining is:" + resourcesRemaining);
        console.log("htmlSaved is:" + htmlSaved);
        if (stylesheetsRemaining <= 0 && resourcesRemaining <= 0 && htmlSaveFunction) {
            console.log("mirroring complete");
            htmlSaveFunction(callback);
        }
    }
}

var Site  = function(id, auth_token, onLoaded) {
    var selectSiteQuery = "\
        SELECT DISTINCT \
            trail_id\
            revision_numbers, \
            saved_stylesheets, \
            saved_resources,\
            base_revision_number,\
            archive_location\
        FROM \
            sites \
        WHERE \
            id = $1\
        AND\
            user_id = ( \
                SELECT DISTINCT id \
                FROM users \
                WHERE \
                wt_authentication_token = $2\
            )\
        ";

    var updateSiteStatement = "\
    UPDATE sites \
    SET \
        revision_numbers = $1, \
        saved_stylesheets = $2, \
        saved_resources = $3,\
        base_revision_number = $4,\
        archive_location = $5\
    WHERE \
        id = $6\
    ";

    var userId = "\
   \
    ";

    var site;
    this.savedResources = [];
    this.savedStylesheets = [];
    this.revisionNumbers = [];
    this.archiveLocation = false;
    this.baseRevisionNumber = false;

    var thisSite = this;

    this.updateSiteInDb = function() {
        var queryParams = [thisSite.revisionNumbers.join(","),
            thisSite.savedStylesheets.join(","),
            thisSite.savedResources.join(","),
            thisSite.baseRevisionNumber,
            thisSite.archiveLocation,
            id];

        if (!((typeof thisSite.baseRevisionNumber) === "number") || !thisSite.archiveLocation) {
            console.log("please set archive location and baseRevisionNumber and ensure correct types (string and int) before saving");
            console.log("archive location is: ", thisSite.archiveLocation);
            console.log("base revision number is: ", thisSite.baseRevisionNumber)
        } else {
            makePgQuery(updateSiteStatement, queryParams, function(res) {
                console.log("site with id:" + id + " updated successfully");
            });
        }
    };

    function loadSiteFromDb() {
        makePgQuery(selectSiteQuery, [id, auth_token], function(res) {
            site = res.rows[0];
            thisSite.savedResources = trimArray(site.saved_resources.split(","));
            thisSite.savedStylesheets = trimArray(site.saved_stylesheets.split(","));
            thisSite.revisionNumbers = trimArray(String((site.revision_numbers) || "").split(","));
            thisSite.baseRevisionNumber = site.base_revision_number;
            thisSite.archiveLocation = site.archive_location;

            onLoaded(thisSite);
        });
    }

    function trimArray(array) {
        return array[0] == "" ? array.splice(1) : array;
    }

    console.log("about to connect to db");
    function makePgQuery(query, parameters, callback) {
        pg.connect(process.env.DATABASE_URL, function(err, client, done){
            if(err) {
                return console.error('error fetching client from pool', err);
            } else {
                client.query(query, parameters, function(err, res) {
                    done();
                    if (err) {
                        console.error("error when query for site");
                        return console.error(err);
                    } else {
                        callback(res)
                    }
                });
            }
        });
    }

    loadSiteFromDb();
}