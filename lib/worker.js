var AWS = require('./aws'),
	_ = require('underscore'),
	config = require('./config').Config,
	Grabber = require('./grabber').Grabber,
	Thumbnailer = require('./thumbnailer').Thumbnailer,
	Saver = require('./saver').Saver,
	fs = require('fs'),
	async = require('async');

/**
 * Generate a path for this thumbnail
 *
 * @param string original The original image path
 * @param string suffix The thumbnail suffix. e.g. "small"
 * @param string format The thumbnail format. e.g. "jpg". Optional.
 */
function getThumbnailKey(original, suffix, format) {
	var extension = original.split('.').pop(),
		prefix = original.split('.').slice(0, -1).join('.');

	return prefix + '_' + suffix + '.' + (format || 'jpg');
};

exports.getThumbnailKey = getThumbnailKey;

/**
 * Initialize the Worker
 *
 * @param object opts Worker configuration. Optional.
 */
function Worker(opts) {
	_.extend(this, {
		thumbnailer: null,
		grabber: null,
		saver: null
	}, opts);

	this.sqs = new AWS.SQS();

	config.set('sqsQueueUrl', this.sqs.endpoint.protocol + '//' + this.sqs.endpoint.hostname + '/' + config.get('sqsQueue'));
}

/**
 * Start the worker
 */
Worker.prototype.start = function() {
	this._processSQSMessage();
};

/**
 * Process the next message in the queue
 */
Worker.prototype._processSQSMessage = function() {
	var _this = this;

	console.log('wait for message on ' + config.get('sqsQueue'));

	this.sqs.receiveMessage( { QueueUrl: config.get('sqsQueueUrl'), MaxNumberOfMessages: 1 }, function (err, job) {
		if (err) {
			console.log(err);
			_this._processSQSMessage();
			return;
		}

		if (!job.Messages || job.Messages.length === 0) {
			_this._processSQSMessage();
			return;
		}

		// Handle the message we pulled off the queue.
		var handle = job.Messages[0].ReceiptHandle,
			body = null;

		try { // a JSON string message body is accepted.
			body = JSON.parse( job.Messages[0].Body );
		} catch(e) {
			if (e instanceof SyntaxError) {
				// a Base64 encoded JSON string message body is also accepted.
				body = JSON.parse( new Buffer(job.Messages[0].Body, 'base64').toString( 'binary' ) );
			} else {
				throw e;
			}
		}

		_this._runJob(handle, body, function(err) {
			if (!err) {
				_this._deleteJob(handle);
			}
			_this._processSQSMessage();
		});
	});
};

/**
 * Process a job from the queue
 *
 * @param string handle The SQS message handle
 * @param object job The job parameters
 * @param function callback The callback function
 */
Worker.prototype._runJob = function(job, callback) {
	/**
		job = {
			"original": "/foo/awesome.jpg",
			"descriptions": [{
				"suffix": "small",
				"width": 64,
				"height": 64
			}],
		}
	*/
	var _this = this;

	this._downloadFromS3(job.original, function(err, localPath) {

		if (err) {
			console.log(err);
			callback(err);
			return;
		}

		_this._createThumbnails(localPath, job, function(err) {
			fs.unlink(localPath, function() {
				callback(err);
			});
		});

	});
};

/**
 * Download the image from S3
 *
 * @param string remoteImagePath The s3 path to the image
 * @param function callback The callback function
 */
Worker.prototype._downloadFromS3 = function(remoteImagePath, callback) {
	this.grabber.download(remoteImagePath, function(err, localPath) {

		// Leave the job in the queue if an error occurs.
		if (err) {
			callback(err);
			return;
		}

		callback(null, localPath);
	});
};

/**
 * Create thumbnails for the image
 *
 * @param string localPath The local path to store the images
 * @param object job The job description
 * @param function callback The callback function
 */
Worker.prototype._createThumbnails = function(localPath, job, callback) {

	var _this = this,
		work = [];

	// Create thumbnailing work for each thumbnail description.
	job.descriptions.forEach(function(description) {
		work.push(function(done) {

			var remoteImagePath = description.path ? description.path : getThumbnailKey(job.original, description.suffix, description.format),
				thumbnailer = new Thumbnailer();

			thumbnailer.execute(description, localPath, function(err, convertedImagePath) {

				if (err) {
					console.log(err);
					done(err);
				} else {
					_this._saveThumbnailToS3(convertedImagePath, remoteImagePath, function(err) {
						if (err) console.log(err);
						done(err, remoteImagePath);
					});
				}

			});

		});
	});

	// perform thumbnailing in parallel.
	async.parallel(work, function(err, results) {
		callback(err, results);
	});

};

/**
 * Save the thumbnail to S3
 *
 * @param string convertedImagePath The local path to the image
 * @param string remoteImagePath The S3 path for the image
 * @param function callback The callback function
 */
Worker.prototype._saveThumbnailToS3 = function(convertedImagePath, remoteImagePath, callback) {
	this.saver.save(convertedImagePath, remoteImagePath, function(err) {
		fs.unlink(convertedImagePath, function() {
			callback(err);
		});
	});
};

/**
 * Remove a job from the queue
 *
 * @param string handle The SQS message handle
 */
Worker.prototype._deleteJob = function(handle) {
	this.sqs.deleteMessage({QueueUrl: config.get('sqsQueueUrl'), ReceiptHandle: handle}, function(err, resp) {
		if (err) {
			console.log("error deleting thumbnail job " + handle, err);
			return;
		}
		console.log('deleted thumbnail job ' + handle);
	});
};

exports.Worker = Worker;

function LocalWorker(s3) {
	this.saver = new Saver(s3);
	this.grabber = new Grabber(s3);
}
LocalWorker.prototype._saveThumbnailToS3 = Worker.prototype._saveThumbnailToS3;
LocalWorker.prototype._downloadFromS3 = Worker.prototype._downloadFromS3;
LocalWorker.prototype.createThumbnails = LocalWorker.prototype._createThumbnails = Worker.prototype._createThumbnails;
LocalWorker.prototype.runJob = Worker.prototype._runJob;

exports.LocalWorker = LocalWorker;
