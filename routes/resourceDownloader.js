AWS = require('aws-sdk');
//AWS.config.loadFromPath('./aws_config.json');
AWS.config.update({accessKeyId: process.env.AWS_KEY, secretAccessKey: process.env.AWS_SECRET});
awsBucket = new AWS.S3({params: {Bucket: 'TrailsSitesProto'}});

var request = require('request');

exports.resourceDownloader = function(req, res){


    console.log("in the resource downloader");
//    console.log(req);

    new ResourceHandler(req)

    res.send({ message: 'success!' });
};

ResourceHandler = function(req) {
    var site = req.body.siteID
    var resources = req.body.originalToAwsUrlMap
    var stylesheets= req.body.styleSheets
    var html = req.body.html
    var isIframe = req.body.isIframe
    var revisionNumber = req.body.revision
    var is_base_revision = req.body.isBaseRevision
    var character_encoding = req.body.characterEncoding
    console.log('in the resource handler');

    function mirrorResource(resourceUrl, mirrorPath) {
        console.log("mirroring " + resourceUrl + " to " + absoluteAwsUrl(mirrorPath));
//        request.get(resourceUrl).pipe(request.put(awsPutOptions));
        var requestOptions = {
            uri: resourceUrl,
            encoding: null
        }
        request(requestOptions, function(error, response, body) {
            if (!error && response.statusCode == 200) {
                putDataOns3(mirrorPath, body, response.headers["content-type"]);
            } else {
                console.log("error downloading from: " + resourceUrl);
            }
        })
    }

    function putDataOns3(path, data, contentType) {
        console.log('saving style sheet with path: ' + path);
        var params = {Key: path, Body: data, ACL: "public-read", CacheControl: "max-age=157680000, public" };
        if (contentType) {
            console.log("Setting content type to: ", contentType);
            params["ContentType"] = contentType;
        }
        awsBucket.putObject(params, function(err, data) {
            if (err) {
                console.log("Error uploading data for path: "  + path + ", err: " + err);
            } else {
                console.log("Successfully uploaded to: " + absoluteAwsUrl(path));
            }
        })
    }

    function absoluteAwsUrl(path) {
        var encodedPath = path.split("/").map(function(sect){ return encodeURIComponent(sect) }).join("/");
        return "https://s3.amazonaws.com/TrailsSitesProto/" + encodedPath
    }

    for ( path in stylesheets ) {
        putDataOns3(path, stylesheets[path]);
    }

    for ( resourceUrl in resources ) {
        mirrorResource(resourceUrl, resources[resourceUrl]);
    }

    putDataOns3(html[0], html[1]);


}