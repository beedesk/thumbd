var AWS = require('aws-sdk'),
	config = require('./config').Config;

AWS.config.update({
	accessKeyId: config.get('awsKey'),
	secretAccessKey: config.get('awsSecret'),
	region: config.get('awsRegion')
});

module.exports = AWS;
