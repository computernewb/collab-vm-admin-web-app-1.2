/** @define {boolean} */
var DEBUG_LOG = false;

function debugLog(msg) {
	if (DEBUG_LOG)
		console.log(msg);
}

/** @const */
var serverAddress = window.location.host;
