// Debug Constants
/** @define {boolean} */
var DEBUG_SERVER_SETTINGS = false;
/** @define {boolean} */
var DEBUG_VM_SETTINGS = false;
/** @define {boolean} */
var DEBUG_LOGIN = false;
/** @define {boolean} */
var DEBUG_LOADING = false;

var tunnel = new Guacamole.WebSocketTunnel("ws://" + serverAddress + "/");
var pingInterval;
/** Currently selected VM in table */
var vmTableSelected;
/** Currently selected VM in settings */
var vmSettingsName;
var vmSettingsVisible = false;

/** @dict
 * List of VMs.
 * Key: VM name (string)
 * Value: VM object
 */
var vmList = {};
// Default settings used for new VMs
var defaultVMSettings = {
	"name": "",
	"vnc-address": "127.0.0.1",
	"vnc-port": 5900,
	"qmp-socket-type": "local",
	"qmp-address": "",
	"qmp-port": 5800,
	"qemu-cmd": "",
	"hypervisor": "qemu",
	"qemu-snapshot-mode": "off",
	"restore-shutdown": false,
	"restore-periodic": false,
	"restore-hours": 0,
	"restore-minutes": 0,
	"turns-enabled": false,
	"turn-time": 20,
	"votes-enabled" : false,
	"vote-time": 60,
	"vote-cooldown-time": 120,
	"agent-enabled": false,
	"agent-socket-type": "local",
	"agent-use-virtio": false,
	"agent-address": "",
	"agent-port": 5700,
	"restore-heartbeat": false,
	"heartbeat-timeout": 0,
	"uploads-enabled": false,
	"upload-cooldown-time": 120,
	"upload-max-size": 20971520,
	"upload-max-filename": 100
};

/**
 * The status of a VM.
 * @enum {number}
 */
var vmStatus = {
	STOPPED: 0,
	STARTING: 1,
	RUNNING: 2,
	STOPPING: 3
}

/** @const */
var statusMessages = [ "Stopped", "Starting", "Running", "Stopping" ];

/**
 * @enum {string}
 */
var vmAction = {
	Stop: "0",	// Stop an admin connection
	SeshID: "1",		// Authenticate with a session ID
	MasterPwd: "2",		// Authenticate with the master password
	GetSettings: "3",	// Get current server settings
	SetSettings: "4",	// Update server settings
	QEMU: "5",			// Execute QEMU monitor command
	StartController: "6",		// Start one or more VM controllers
	StopController: "7",		// Stop one or more VM controllers
	RestoreVM: "8",		// Restore one or more VMs
	RebootVM: "9",		// Reboot one or more VMs
	ResetVM: "10",		// Reset one or more VMs
	RestartVM: "11"		// Restart one or more VM hypervisors
}

function getCookie(cname) {
	var name = cname + "=";
	var ca = document.cookie.split(';');
	for(var i=0; i<ca.length; i++) {
		var c = ca[i];
		while (c.charAt(0)==' ') c = c.substring(1);
		if (c.indexOf(name) == 0) return c.substring(name.length,c.length);
	}
	return "";
}

function forEachInput(settings, callback) {
	settings.find("input")/*.filter(":visible")*/
		.filter(function() {
			return this.name && !$(this).is(":disabled") && (this.value != undefined || this.checked);
		})
		.each(function() {
			var value = null;
			if ($(this).is(":checkbox")) {
				value = this.checked;
			} else if ($(this).attr("type") === "number") {
				value = this.value;
			} else {
				value = '"' + this.value + '"';
			}
			callback(this.name, value);
		});
	// Find dropdown buttons
	settings.find("button.dropdown-toggle")/*.filter(":visible")*/
		.filter(function() {
			return this.name && !$(this).is(":disabled") && $(this).data("value");
		})
		.each(function() {
			callback(this.name, "\"" + $(this).data("value") + "\"");
		});
}

function saveServerSettings() {
	displayLoading();
	var json = "";
	forEachInput($("#server-settings"), function(name, value) {
		json += "\"" + name + "\":" + value + ",";
	});
	if (!json)
		return;
	json =  '{"settings":{' + json.substring(0, json.length - 1) + "}}";
	debugLog(json);
	tunnel.sendMessage("admin", 4, json);
}

function saveVMSettings() {
	displayLoading();
	var json = "";
	forEachInput($("#vm-settings"), function(name, value) {
		// Remove the "vm-" prefix
		if (name.match("^vm-"))
			json += "\"" + name.substr(3) + "\":" + value + ",";
	});
	/*if (!$("#restore-periodic-chkbox").prop("disabled"))
		json += "\"restore-periodic\":" + (parseInt($("#restore-hours-box").val()) * 60 + parseInt($("#restore-minutes-box").val())).toString() + ",";*/
	if (!json)
		return;
	// Append the VM ID to the JSON if a current VM's settings are being changed
	if (vmSettingsName)
		json =  '{"update-vm":{' + json.substring(0, json.length - 1) + "}}";
	else
		json =  '{"add-vm":{' + json.substring(0, json.length - 1) + "}}";

	debugLog(json);
	
	vmSettingsName = null;
	$("#vm-settings").hide();
	$("#vm-list").parent().addClass("table-hover");
	$("#new-vm-btn").prop("disabled", true);
	
	tunnel.sendMessage("admin", 4, json);
}

function splitQueryString(query) {
	var keyValuePairs = query.split('&');
	var urlParams = {};
	for (var i = 0; i < keyValuePairs.length; i++) {
		var keyValuePair = keyValuePairs[i].split('=');
		var paramName = decodeURIComponent(keyValuePair[0]);
		var paramValue = keyValuePair[1] || '';
		urlParams[paramName] = decodeURIComponent(paramValue.replace(/\+/g, ' '));
	}
	return urlParams;
}

/**
 * Finds an input with the specified name and sets its value.
 * @returns True when the input was found.
 */
function setInputValue(settings, name, value) {
	var x = settings.find("input[name='" + name + "']").eq(0);
	// Text, number,and checkbox inputs
	if (x.length) {
		if (x.is(":checkbox")) {
			x.prop("checked", value == "1" ? true : false);
			// Call the change handler for the checkbox
			x.trigger("change");
		} else
			x.val(value);
		return true;
	} else if ((x = settings.find("button.dropdown-toggle[name='" + name + "']").eq(0)).length) {
		// Dropdown buttons
		var item = x.parent().find("ul.dropdown-menu li a[data-value='" + value + "']").eq(0);
		if (item.length) {
			x.html(item.text() + ' <span class="caret"></span>');
			x.data("value", value);
			x.trigger("dropdown");
			return true;
		}
	}
	return false;
}

/**
 * Displays an error that occurred while changing the settings.
 * @param {string=} key The name of the value that caused the error (optional).
 * @param {string} value The error message.
 * @param {boolean=} success If it is a success message (optional).
 */
function displaySettingsError(key, value, success) {
	var alert;
	if (success)
		alert = createAlert('<strong>Successfully changed settings</strong>', false, "success");
	else
		alert = createAlert("<strong>Settings Error</strong><br>" + (value ? "<em>" + key + "</em>: " + value : key));
	
	$("#alert-box").parent().parent().prepend(alert);
	alert.show("fast");
}

function parseSettings(json) {
	var obj = jQuery.parseJSON(json);
	if (obj.result) {
		// If the result isn't true it means an error occurred
		if (obj.result !== true) {
			debugLog("Error changing settings");
			debugLog(obj.result);
			if (typeof obj.result === "object")
				$.each(obj.result, displaySettingsError);
			else
				displaySettingsError(obj.result);
		} else {
			debugLog("Successfully changed settings");
			displaySettingsError(null, null, true);
		}
	}
	if (obj.settings) {
		var settings = $("#server-settings");
		var vmTable = $("#vm-list");
		vmTable.html("");
		vmTableSelected = null;
		$.each(obj.settings, function(key, value) {
				if (key == "vm" && $.isArray(value)) {
					$.each(value, function(i, vm) {
						if (vm.hasOwnProperty("name")) {
							// Add to VM dictionary
							vmList[vm.name] = vm;
							// Create table row
							var row = document.createElement("tr");
							var d = document.createElement("td");
							d = document.createElement("td");
							d.innerHTML = vm.name;
							row.appendChild(d);
							d = document.createElement("td");
							d.innerHTML = statusMessages[vm.status];
							row.appendChild(d);
							
							$(row).click(function() {
								if (!$("#vm-settings").is(":visible")) {
									vmTableSelected = $(this).addClass("info").find("td").eq(0).text();
									updateVMButtons(vmList[vmTableSelected]);
								}
							});
							vmTable.append(row);
						}
					});
				} else {
					setInputValue(settings, key, value);
				}
			});
	}
	if (!$("#server-settings").is(":visible"))
		displayServerSettings();
}

/**
 * Enables or disables the buttons below the VM table
 * depending on the state of the currently selected VM.
 */
function updateVMButtons(vm) {
	var vmSettingsVisible = $("#vm-settings").is(":visible");
	$("#start-vm-btn").prop("disabled", vmSettingsVisible || !vm || vm.status != vmStatus.STOPPED);
	$("#stop-vm-btn").prop("disabled", vmSettingsVisible || !vm  || vm.status != vmStatus.RUNNING);
	$("#restart-vm-btn").prop("disabled", vmSettingsVisible || !vm || vm.status != vmStatus.RUNNING);
	//$("#restore-vm-btn").prop("disabled", vmSettingsVisible || !vm || vm.status != vmStatus.RUNNING);
	$("#vm-action-btn").prop("disabled", vmSettingsVisible || !vm || vm.status != vmStatus.RUNNING);
	$("#settings-vm-btn").prop("disabled", vmSettingsVisible || !vm);
}

function getConfig() {
	displayLoading();
	tunnel.sendMessage("admin", 3);
}

function restoreVM(vmId) {
	tunnel.sendMessage("admin", 9, vmId);
}

function displayLoading() {
	$("#vm-settings").hide();
	$("#server-settings").hide();
	$("#password-input").hide();
	$("#loading").show();
}

function displayPasswordInput() {
	$("#vm-settings").hide();
	$("#server-settings").hide();
	$("#loading").hide();
	$("#invalid-pwd").hide();
	$("#master-pwd").val("").prop("disabled", false);
	$("#pwd-submit").prop("disabled", false);
	$("#password-input").show("slow");
}

function displayServerSettings() {
	$("#password-input").hide();
	if (!vmSettingsName)
		$("#vm-settings").hide();
	else {
		$("#vm-settings").show();
		updateVMButtons(vmList[vmSettingsName]);
	}
	$("#loading").hide();
	$("#server-settings").show("slow");
}

/**
 * Display the settings for a VM.
 * @param name The name of the VM or null for a new VM.
 */
function showVMSettings(name) {
	var vm;
	var heading;
	if (name) {
		vm = vmList[name];
		if (!vm)
			return;
		heading = "<em>" + vm.name + "</em> Settings";
		$("#delete-vm-btn").show();
		$("#qemu-monitor").show();
	} else {
		vm = defaultVMSettings;
		heading = "New VM Settings";
		$("#delete-vm-btn").hide();
		$("#qemu-monitor").hide();
	}
	$("#vm-panel-heading").html(heading);
	var vmSettings = $("#vm-settings");
	$.each(vm, function(key, value) {
		setInputValue(vmSettings, "vm-" + key, value);
	});
	$("#restore-hours-box").val(0);
	$("#restore-minutes-box").val(0);
	vmSettingsName = name;

	/*$("#vm-settings").show("slow");
	$("#vm-list").parent().removeClass("table-hover");
	$("#new-vm-btn").prop("disabled", true);*/
	hideVMSettings(true);
}

function hideVMSettings(show) {
	show = !!show;
	$("#new-vm-btn").prop("disabled", show);
	if (show) {
		$("#vm-list").parent().removeClass("table-hover");
		$("#vm-settings").show("slow");
	} else {
		$("#vm-list").parent().addClass("table-hover");
		$("#vm-settings").hide("fast");
		vmSettingsName = null;
	}
	vmSettingsVisible = show;
}

/**
 * Creates an alert with Bootstrap.
 * @param msg The message inside of the alert. Can be HTML.
 * @param visible Whether the alert is initially visible or not. Defaults to visible.
 * @param type The type of alert to display. Valid values are: success, info, warning, danger. Default to danger.
 */
function createAlert(msg, visible, type) {
	/*var alert = document.getElementById("div");
	alert.className = "alert alert-" + (type || "danger");
	alert.setAttribute("role", "alert");
	alert.innerHTML = msg;*/
	return $('<div class="alert alert-' + (type || "danger") + ' alert-dismissible" role="alert"' + (visible ? '' : ' style="display: none;"') + '><button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>' + msg + '</div>');
}

function submitPassword() {
	$("#invalid-pwd").hide();
	var input = $("#master-pwd");
	input.prop("disabled", true);
	$("#pwd-submit").prop("disabled", true);
	tunnel.sendMessage("admin", 2, input.val());
}

function changePassword() {
	tunnel.sendMessage("admin", 4, '{"password":"' + $("#chng-pwd-box").val() + '"}');
}

tunnel.onstatechange = function(state) {
	switch (state) {
		case Guacamole.Tunnel.State.OPEN:
			debugLog("Connected to server");
			// Send the admin instruction
			var seshID = getCookie("sessionID");
			if (seshID)
				tunnel.sendMessage("admin", 1, seshID);
			else
			{
				displayPasswordInput();
			}
			/*if (!pingInterval)
				pingInterval = window.setInterval(function() {
					tunnel.sendMessage("sync", 0);
				}, 5000);*/
			break;
		case Guacamole.Tunnel.State.CLOSED:
			debugLog("Disconnected from server");
			displayLoading();
			
			if (pingInterval) {
                window.clearInterval(pingInterval);
				pingInterval = null;
			}
			
			reconnect();
			break;
	}
};

tunnel.oninstruction = function(opcode, parameters) {
	if (opcode == "admin") {
		if (parameters.length > 1) {
			var x = parseInt(parameters[0]);
			if (!isNaN(x)) {
				switch (x) {
					case 0:
						// TODO: Change to switch-case
						if (parameters[1] == 0) {
							// Login failed
							if (!$("#password-input").is(":visible"))
								displayPasswordInput();
							var alert = createAlert("<strong>Invalid Password</strong>");
							$("#password-input").prepend(alert);
							alert.show("fast");
							var input = $("#master-pwd");
							input.val("");
							input.prop("disabled", false);
							$("#pwd-submit").prop("disabled", false);
						} else if (parameters[1] == 1) {
							// Login succeeded
							vmSettingsName = null;
							vmTableSelected = null;
							$("#vm-list").html("");
							getConfig();
						} else if (parameters[1] == 2) {
							// Invalid VM ID
							displaySettingsError("Invalid VM ID");
						}
						break;
					case 1:
						parseSettings(parameters[1]);
						if (!$("#server-settings").is(":visible"))
							displayServerSettings();
						break;
					case 2:
						qemuMonitorOutput("&#13;&#10;" + parameters[1]);
						break;
					case 3:
						// Update a VM's status code
						if (vmList.hasOwnProperty(parameters[1])) {
							var vm = vmList[parameters[1]];
							vm.status = parameters[2];
							vm.active = vm.status != vmStatus.STOPPED;
							// Find the table data element
							$("#vm-list > tr").each(function() {
								var data = $(this).children("td");
								if (data.eq(0).html() == vm.name) {
									data.eq(1).html(statusMessages[vm.status]);
									return false;
								}
							});
							if (vmTableSelected === vm.name)
								updateVMButtons(vm);
						}
						break;
				}
			}
		}
	} else if (opcode == "nop") {
		tunnel.sendMessage("nop");
	}
};

function connect() {
	if (tunnel.state == Guacamole.Tunnel.State.CONNECTING || tunnel.state == Guacamole.Tunnel.State.CLOSED) {
		try {
			displayLoading();
			tunnel.connect();
		}
		catch (status) {
			reconnect();
		}
	} else {
		tunnel.disconnect();
	}
}

function reconnect() {
	// Try to reconnect in 5 seconds
	setTimeout(function () {
		tunnel.state = Guacamole.Tunnel.State.CONNECTING;
		connect();
	}, 5000);
}

function sendQEMUCmd() {
	if (tunnel.state == Guacamole.Tunnel.State.OPEN && vmSettingsName != null) {
		var cmdInput = $("#qemu-monitor-input");
		var cmd = cmdInput.val().trim();
		tunnel.sendMessage("admin", 5, vmSettingsName, cmd);
		qemuMonitorOutput("&#13;&#10;> " + cmd);
		cmdInput.val("");
	}
}

function qemuMonitorOutput(append) {
	var cmdOutput = $("#qemu-monitor-output");
	cmdOutput.html(cmdOutput.html() + append + "&#13;&#10;");
	cmdOutput.scrollTop(cmdOutput[0].scrollHeight);
}

$(function() {
	// Add click handler for all dropdown buttons
	$("div.btn-group").not("[data-no-dropdown]").find("ul.dropdown-menu li a").click(function (e) {
		e.preventDefault();
		var li = $(this).parent();
		if (li.hasClass("disabled"))
			return;
		var div = li.parent().parent(); 
		var btn = div.find("button");
		btn.html($(this).text() + ' <span class="caret"></span>');
		var val = $(this).data("value");
		btn.data("value", val);
		div.removeClass("open");
		btn.trigger("dropdown", val);
	});
	
	$("#start-vm-btn").click(function() {
		tunnel.sendMessage("admin", vmAction.StartController, vmTableSelected);
	});
	
	$("#stop-vm-btn").click(function() {
		tunnel.sendMessage("admin", vmAction.StopController, vmTableSelected);
	});
	
	/*$("#restore-vm-btn").click(function() {
		tunnel.sendMessage("admin", vmAction.RestoreVM, vmTableSelected);
	});*/
	
	$("#restart-vm-btn").click(function() {
		tunnel.sendMessage("admin", vmAction.RestartVM, vmTableSelected);
	});
	
	$("#vm-action-dropdown ul.dropdown-menu li a").click(function (e) {
		e.preventDefault();
		tunnel.sendMessage("admin", vmAction[$(this).data("value")], vmTableSelected);
	});
	
	$("#settings-vm-btn").click(function() {
		if ($("#vm-settings").is(":visible")) {
			alert("Please close the current VM settings before editing this VM's settings.");
		} else {
			showVMSettings(vmTableSelected);
		}
	});
	
	$("#new-vm-btn").click(function() {
		if (vmSettingsName || $("#vm-settings").is(":visible")) {
			alert("Please close the current VM settings before adding a new VM.");
		} else {
			showVMSettings(null);
		}
	});
	
	$('#vm-qemu-snapshot-mode').on("dropdown", function() {
		var enabled = $(this).data("value") == "hd";
		$("#restore-shutdown-chkbox").prop("disabled", !enabled);
		$("#restore-periodic-chkbox").prop("disabled", !enabled);
		$("#restore-periodic-chkbox").trigger("change");
	});
	
	$("#qemu-monitor-send").click(function() {
		sendQEMUCmd();
	});
	
	$("#qemu-monitor-input").keypress(function(e) {
		// If the user has pressed enter
		if (e.which === 13) {
			sendQEMUCmd();
		}
	});
	
	$("#chng-pwd-chkbox").change(function() {
		var disabled = !$(this).prop("checked");
		$("#chng-pwd-box").prop("disabled", disabled);
		$("#chng-pwd-btn").prop("disabled", disabled);
	});
	
	$("#chng-pwd-btn").click(function() {
		changePassword();
	});
	
	/*$("#web-server-chkbox").change(function() {
		$("#web-server-box").prop("disabled", !$(this).prop("checked"));
	});*/
		
	$("#turns-enabled-chkbox").change(function() {
		$("#turn-time-box").prop("disabled", !$(this).prop("checked"));
	});
	
	$("#votes-enabled-chkbox").change(function() {
		$("#vote-time-box, #vote-cooldown-time-box").prop("disabled", !$(this).prop("checked"));
	});
	
	$("#agent-enabled-chkbox").change(function() {
		$("#agent-socket-type-dropdown, #agent-use-virtio-chkbox, #agent-address-box, #restore-heartbeat-chkbox, #uploads-enabled-chkbox").prop("disabled", !$(this).prop("checked")).trigger("disabled");
	});
	
	$("#agent-socket-type-dropdown").on("dropdown", function(e, val){
		$("#agent-port").prop("disabled", val !== "tcp");
	}).on("disabled", function() {
		$("#agent-port").prop("disabled", $(this).prop("disabled") || $(this).data("value") !== "tcp");
	});
	
	/*$("#restore-heartbeat-chkbox").change(function() {
		$("#heartbeat-timeout-box").prop("disabled", !$(this).prop("checked"));
	}).on("disabled", function() {
		$("#heartbeat-timeout-box").prop("disabled", $(this).prop("disabled") || !$(this).prop("checked"));
	});*/
		
	$("#uploads-enabled-chkbox").change(function() {
		$("#upload-cooldown-time-box, #upload-max-size-box, #upload-max-filename-box").prop("disabled", !$(this).prop("checked"));
	}).on("disabled", function() {
		$("#upload-cooldown-time-box, #upload-max-size-box, #upload-max-filename-box").prop("disabled", $(this).prop("disabled") || !$(this).prop("checked"));
	});
	
	$("#restore-periodic-chkbox").change(function() {
		var disabled = !$(this).prop("checked");
		$("#restore-hours-box").prop("disabled", disabled);
		$("#restore-minutes-box").prop("disabled", disabled);
	});
	
	$("#vm-name").keydown(function(e) {
		// Don't allow spaces
		if (e.which === 32)
			e.preventDefault();
	});
	
	$("#delete-vm-btn").click(function() {
		if (vmSettingsName) {
			if (window.confirm("Are you sure you want to delete this VM?")) {
				tunnel.sendMessage("admin", 4, '{"del-vm":"' + vmSettingsName + '"}');
				hideVMSettings();
			}
		}
	});
	
	$("#save-server-settings").click(function() {
		saveServerSettings();
	});
	
	$("#save-vm-btn").click(function() {
		saveVMSettings();
	});
	
	$("#pwd-submit").click(function() {
		submitPassword();
	});
	
	$("#master-pwd").keypress(function(e) {
		// If the user has pressed enter
		if (e.which === 13) {
			submitPassword();
		}
	});
	
	$("#vm-x-btn").click(function() {
		if (window.confirm("Warning\nIf you changed any settings they will not be saved.\n\nContinue?"))
			hideVMSettings();
	});
	
	var debug = '{"settings":{"chat-rate-count":4,"chat-rate-time":3,"chat-mute-time":30,"max-cons":5,"max-upload-time":120,"vm":[{"id":0,"auto-start":true,"status":3,"display-name":"Windows XP","name":"win-xp","vnc-address":"127.0.0.1","vnc-port":5900,"qmp-address":"","qmp-port":5800,"qemu-cmd":"qemu-system-x86_64 -hda /home/user/Documents/win-xp-vm/win-xp.img -usbdevice tablet","restore-shutdown":true,"turns-enabled":true,"turn-time":20,"votes-enabled":true,"vote-time":60,"vote-cooldown-time":0,"qmp-socket-type":"local","hypervisor":"qemu","qemu-snapshot-mode":"hd","agent-enabled":false,"agent-socket-type":"local","agent-use-virtio":false,"agent-address":"","agent-port":5700,"uploads-enabled":false,"upload-cooldown-time":120,"upload-max-size":20971520,"upload-max-filename":100}]}}';
	if (DEBUG_SERVER_SETTINGS) {
		parseSettings(debug);
		displayServerSettings();
	} else if (DEBUG_VM_SETTINGS) {
		parseSettings(debug);
		displayServerSettings();
		showVMSettings("win-xp");
	} else if (DEBUG_LOGIN) {
		displayPasswordInput();
	} else if (DEBUG_LOADING) {
		displayLoading();
	} else {
		connect();
	}
});