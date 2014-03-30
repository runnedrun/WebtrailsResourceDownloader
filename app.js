
/**
 * Module dependencies.
 */

var express = require('express')
  , routes = require('./routes/resourceDownloader')
  , http = require('http')
  , path = require('path');


var app = express();

app.configure(function(){
  app.set('port', process.env.PORT || 3000);
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.cookieParser());
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(path.join(__dirname, 'public')));
});

app.configure('development', function(){
  app.use(express.errorHandler());
});

app.locals({
    awsBucket: "TrailSitesProto"
});

//app.use(function(req, res, next) {
//    res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000,http://www.webtrails.co");
//    return next();
//});

//app.get('/', routes.index);
app.post('/resource_downloader', routes.resourceDownloader);

http.createServer(app).listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});
