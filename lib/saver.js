var AWS = require('./aws'),
	url = require('url'),
	fs = require('fs'),
	mime = require('mime'),
	config = require('./config').Config;

/**
 * Initialize the Saver
 *
 * @param object s3 The S3 client
 */
function Saver(s3) {
	if (s3) {
		this.s3 = s3;
		return;
	}

	this.s3 = new AWS.S3();
}

/**
 * Save the local file to s3 bucket
 *
 * @param string source The local file path
 * @param string destination The s3 remote target file path
 * @param function callback The callback function. Optional
 */
Saver.prototype.save = function(source, destination, callback) {

	if (destination.match(/https?:\/\//)) {
		destination = this.destinationFromURL(destination);
	}

	var stream = fs.createReadStream(source);
	var params = {
		Bucket: config.get('s3Bucket'),
		Key: destination,
		Body: stream,
		ContentType: mime.lookup(source),
		ACL: config.get('s3Acl'),
		StorageClass: config.get('s3StorageClass')
	};
	this.s3.putObject(params, function(err, res) {
		if (err) {
			if (callback) callback(err);
		} else {
			console.log('saved ' + source + ' to ' + destination);
			if (callback) callback();
		}
	});
};

/**
 * Get a file path from a URL
 *
 * @param string destination The destination url. e.g. http://example.com/foo/test.jpg
 *
 * @return string The file path. E.g. example.com/foo/test.jpg
 */
Saver.prototype.destinationFromURL = function(destination) {
	var parsedURL = url.parse(destination);
	return parsedURL.hostname + parsedURL.path;
};

exports.Saver = Saver;
