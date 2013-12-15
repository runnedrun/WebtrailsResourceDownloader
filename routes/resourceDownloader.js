AWS = require('aws-sdk');
AWS.config.loadFromPath('./aws_config.json')
awsBucket = new AWS.S3({params: {Bucket: 'TrailsSitesProto'}});

exports.resourceDownloader = function(req, res){


    console.log(is_base_revision);
//    console.log(req);

    new ResourceHandler(req)

    res.render('index', { title: 'Express' });
};

ResourceHandler = function(req) {
    var site = req.query.siteID
    var resources = req.query.originalToAwsUrlMap
    var stylesheets= req.query.styleSheets
    var html = req.query.html
    var isIframe = req.query.isIframe
    var revisionNumber = req.query.revision
    var is_base_revision = req.query.isBaseRevision
    var character_encoding = req.query.characterEncoding

    function saveStylesheets(styleSheets) {
        for ( path in styleSheets ) {
            var params = {Key: path, Body: styleSheets[path], ACL: "public-read", CacheControl: "max-age=157680000, public" };
            awsBucket.putObject(params, function(err, data) {
                if (err) {
                    console.log("Error uploading data for path: "  + path + ", err: " + err);
                } else {
                    console.log("Successfully uploaded: " + path);
                }
            })
        }
    }

    saveStylesheets(stylesheets)
}