// Global variables
let isPaused = false;
let cycleCount = 0;
let currentLogs = new Set();
let lastScrollPosition = 0;
let isScrolledToBottom = true;
let serverCycleCount = 0;
let currentLists = [];
const MAC_PATTERN = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
const OUI_PATTERN = /^([0-9A-Fa-f]{2}[:-]){2}([0-9A-Fa-f]{2})$/;

// DOM Elements
const deviceList = document.getElementById('device-list');
const monitorStatus = document.getElementById('monitor-status');
const cycleCounter = document.getElementById('cycle-count');
const interfaceStatus = document.createElement('div');
interfaceStatus.className = 'status-item';
interfaceStatus.innerHTML = `
    <span class="status-label">INTERFACE:</span>
    <span id="interface-status" class="status-value">
        <span class="status-dot"></span>
        <span class="status-text">CHECKING</span>
    </span>
`;
document.querySelector('.status-info').appendChild(interfaceStatus);

// Tab Management
function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.getAttribute('data-tab');
            switchTab(tabName);
        });
    });
}

function switchTab(tabName) {
    // Update button states
    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.toggle('active', button.getAttribute('data-tab') === tabName);
    });

    // Update content visibility
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}-tab`);
    });
}

// List Management
let activeLists = new Set();
let inactiveLists = new Set();

async function loadInitialConfig() {
    try {
        const response = await fetch('/api/initial-config');
        const data = await response.json();
        
        // Update lists
        activeLists = new Set(data.lists.active);
        inactiveLists = new Set(data.lists.inactive);
        updateListDisplays();
        
        // Update configuration display
        if (data.config) {
            updateConfigDisplay(data.config);
        }
    } catch (error) {
        console.error('Error loading initial configuration:', error);
        showNotification('Failed to load initial configuration', 'error');
    }
}

async function initializeSettings() {
    try {
        // Fetch current settings
        const response = await fetch('/api/current-settings');
        const data = await response.json();
        
        if (data.status === 'success') {
            const settings = data.settings;
            
            // Update interface select
            const interfaceSelect = document.getElementById('interface-select');
            if (interfaceSelect) {
                interfaceSelect.value = settings.interface;
            }
            
            // Update capture time
            const captureTimeInput = document.getElementById('capture-time-input');
            if (captureTimeInput) {
                captureTimeInput.value = settings.capture_time;
            }
            
            // Update band checkboxes
            const band2g = document.getElementById('band-2ghz');
            const band5g = document.getElementById('band-5ghz');
            if (band2g) band2g.checked = settings.band2G;
            if (band5g) band5g.checked = settings.band5G;
            
            // Initialize channel grids
            const channels2G = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
            const channels5G = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 149, 153, 157, 161, 165];
            
            const grid2G = document.getElementById('channels-2ghz');
            const grid5G = document.getElementById('channels-5ghz');
            
            if (grid2G && grid5G) {
                grid2G.innerHTML = '';
                grid5G.innerHTML = '';
                
                channels2G.forEach(channel => {
                    const div = document.createElement('div');
                    div.className = 'channel-checkbox';
                    div.innerHTML = `
                        <input type="checkbox" id="ch-2g-${channel}" value="${channel}"
                               ${settings.channels2G.includes(channel) ? 'checked' : ''}>
                        <label for="ch-2g-${channel}">${channel}</label>
                    `;
                    grid2G.appendChild(div);
                });
                
                channels5G.forEach(channel => {
                    const div = document.createElement('div');
                    div.className = 'channel-checkbox';
                    div.innerHTML = `
                        <input type="checkbox" id="ch-5g-${channel}" value="${channel}"
                               ${settings.channels5G.includes(channel) ? 'checked' : ''}>
                        <label for="ch-5g-${channel}">${channel}</label>
                    `;
                    grid5G.appendChild(div);
                });
            }
            
            // Update grid opacity based on band selection
            if (grid2G) grid2G.style.opacity = settings.band2G ? '1' : '0.5';
            if (grid5G) grid5G.style.opacity = settings.band5G ? '1' : '0.5';
        }
    } catch (error) {
        console.error('Error initializing settings:', error);
        showNotification('Failed to load settings', 'error');

    }
    document.getElementById('interface-apply').addEventListener('click', applyInterfaceSettings);
    document.getElementById('scan-apply').addEventListener('click', applyScanSettings);
    document.getElementById('settings-reset').addEventListener('click', resetSettings);
}


async function loadWirelessInterfaces() {
    try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        
        const interfaceSelect = document.getElementById('interface-select');
        if (interfaceSelect) {
            interfaceSelect.innerHTML = ''; // Clear existing options
            
            // Add available interfaces
            if (data.interfaces && data.interfaces.length > 0) {
                data.interfaces.forEach(iface => {
                    const option = document.createElement('option');
                    option.value = iface;
                    option.textContent = iface;
                    interfaceSelect.appendChild(option);
                });
                
                // Set current interface if it exists in settings
                if (data.settings && data.settings.interface) {
                    interfaceSelect.value = data.settings.interface;
                }
            } else {
                // Add a placeholder if no interfaces found
                const option = document.createElement('option');
                option.value = '';
                option.textContent = 'No wireless interfaces found';
                option.disabled = true;
                interfaceSelect.appendChild(option);
            }
        }
        
        // Add refresh button listener
        const refreshBtn = document.getElementById('refresh-interfaces');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                await loadWirelessInterfaces();
                showNotification('Wireless interfaces refreshed');
            });
        }
    } catch (error) {
        console.error('Error loading wireless interfaces:', error);
        showNotification('Failed to load wireless interfaces', 'error');
    }
}

async function applyInterfaceSettings() {
    try {
        const settings = {
            interface: document.getElementById('interface-select')?.value || 'wlan0'
        };

        const response = await fetch('/api/apply-interface', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        
        if (!response.ok) throw new Error('Network response was not ok');
        
        const result = await response.json();
        if (result.status === 'success') {
            showNotification('Interface settings applied successfully');
        } else {
            showNotification(result.message || 'Failed to apply interface settings', 'error');
        }
    } catch (error) {
        console.error('Error applying interface settings:', error);
        showNotification('Failed to apply interface settings', 'error');
    }
}

async function applyScanSettings() {
    try {
        // Get the settings
        const settings = {
            captureTime: parseInt(document.getElementById('capture-time-input')?.value || '13'),
            band2G: document.getElementById('band-2ghz')?.checked || false,
            band5G: document.getElementById('band-5ghz')?.checked || false,
            channels2G: Array.from(document.getElementById('channels-2ghz')?.querySelectorAll('input:checked') || [])
                .map(cb => cb.value),
            channels5G: Array.from(document.getElementById('channels-5ghz')?.querySelectorAll('input:checked') || [])
                .map(cb => cb.value)
        };

        // Debug log
        console.log('Sending scan settings:', settings);

        const response = await fetch('/api/apply-scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        
        const result = await response.json();
        console.log('Server response:', result);  // Debug log
        
        if (result.status === 'success') {
            showNotification('Scan settings applied successfully');
            // Force immediate updates
            await updateStatus();
            await updateChannelDisplay();
        } else {
            showNotification(result.message || 'Failed to apply scan settings', 'error');
        }
    } catch (error) {
        console.error('Error applying scan settings:', error);
        showNotification('Failed to apply scan settings. Check console for details.', 'error');
    }
}

async function updateListDisplays() {
    const activeContainer = document.getElementById('active-lists');
    const inactiveContainer = document.getElementById('inactive-lists');
    
    if (!activeContainer || !inactiveContainer) return;
    
    activeContainer.innerHTML = '';
    inactiveContainer.innerHTML = '';
    
    activeLists.forEach(list => {
        const listElement = createListElement(list, true);
        activeContainer.appendChild(listElement);
    });
    
    inactiveLists.forEach(list => {
        const listElement = createListElement(list, false);
        inactiveContainer.appendChild(listElement);
    });
}

function createListElement(listName, isActive) {
    const div = document.createElement('div');
    div.className = `list-item ${isActive ? 'active' : ''}`;
    div.innerHTML = `
        <span class="list-name">${listName}</span>
        <span class="list-status ${isActive ? 'active' : 'inactive'}">
            ${isActive ? 'ACTIVE' : 'INACTIVE'}
        </span>
    `;
    
    div.addEventListener('click', () => toggleListStatus(listName, isActive));
    return div;
}

async function toggleListStatus(listName, currentlyActive) {
    try {
        const response = await fetch('/api/toggle-list', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: listName,
                active: !currentlyActive
            })
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            // Update the local Sets
            if (currentlyActive) {
                activeLists.delete(listName);
                inactiveLists.add(listName);
            } else {
                inactiveLists.delete(listName);
                activeLists.add(listName);
            }
            
            // Update the display
            await updateListDisplays();
            showNotification(`List ${listName} ${currentlyActive ? 'deactivated' : 'activated'}`);
            
            // Force a refresh of the lists display
            await fetchListStatus();
        } else {
            showNotification(data.message || 'Failed to toggle list status', 'error');
        }
    } catch (error) {
        console.error('Error toggling list status:', error);
        showNotification('Failed to toggle list status', 'error');
    }
}

async function fetchListStatus() {
    try {
        const response = await fetch('/api/lists-status');
        const data = await response.json();
        
        console.log('Lists status:', data); // Add debug logging
        
        activeLists = new Set(data.active || []);
        inactiveLists = new Set(data.inactive || []);
        
        await updateListDisplays();
    } catch (error) {
        console.error('Error fetching list status:', error);
        showNotification('Failed to fetch list status', 'error');
    }
}



// Style for status dot
const style = document.createElement('style');
style.textContent = `
    .status-dot {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        margin-right: 5px;
    }
    
    .status-dot.active {
        background-color: var(--neon-green);
        box-shadow: 0 0 10px var(--neon-green);
    }
    
    .status-dot.inactive {
        background-color: var(--error-red);
        box-shadow: 0 0 10px var(--error-red);
    }
`;
document.head.appendChild(style);

// Add Control Buttons
function addControlButtons() {
    const controlGroup = document.querySelector('.control-group');
    
    // Add Device button
    const addBtn = document.createElement('button');
    addBtn.className = 'neon-button';
    addBtn.innerHTML = '<span class="button-text">ADD DEVICE</span>';
    addBtn.addEventListener('click', showAddDeviceDialog);
    
    // Pause button
    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'neon-button';
    pauseBtn.id = 'pause-btn';
    pauseBtn.innerHTML = '<span class="button-text">PAUSE</span>';
    pauseBtn.addEventListener('click', togglePause);
        
    // Clear button
    const clearBtn = document.createElement('button');
    clearBtn.className = 'neon-button';
    clearBtn.id = 'clear-btn';
    clearBtn.innerHTML = '<span class="button-text">CLEAR LOG</span>';
    clearBtn.addEventListener('click', clearLogs);
    
    // Add buttons to control group
    controlGroup.appendChild(addBtn);
    controlGroup.appendChild(pauseBtn);
    controlGroup.appendChild(clearBtn);
}

// Format MAC address with color coding
function formatMacAddress(mac) {
    if (!mac) return '';
    const oui = mac.slice(0, 8);
    const rest = mac.slice(8);
    return `<span class="oui">${oui}</span><span class="mac">${rest}</span>`;
}

// Device Entry Creation
function createDeviceEntry(logData) {
    const match = logData.match(/\[(.*?)\] \| (.*?) \| (.*?) \| Ch: (.*?) \| List: (.*)/);
    if (!match) return null;
    
    const [_, timestamp, mac, name, channel, list] = match;
    const div = document.createElement('div');
    div.className = 'device-entry';
    div.innerHTML = `
        <div class="entry-content">
            <span class="timestamp">[${timestamp}]</span>
            <span class="separator">|</span>
            ${formatMacAddress(mac)}
            <span class="separator">|</span>
            <span class="device-name">${name}</span>
            <span class="separator">|</span>
            <span class="list-name">List: ${list}</span>
        </div>
        <span class="channel-tag">CH ${channel}</span>
    `;
    
    return div;
}

// Dialogs
function showAddDeviceDialog() {
    fetchLists().then(lists => {
        const dialog = document.createElement('div');
        dialog.className = 'cyber-panel add-device-dialog';
        dialog.innerHTML = `
            <h3 class="cyber-title">Add Device</h3>
            <div class="input-group">
                <input type="text" id="deviceMac" class="input-field" 
                       placeholder="MAC/OUI (e.g., 00:11:22:33:44:55 or 00:11:22)">
                <span id="macValidation" class="validation-message"></span>
            </div>
            <div class="input-group">
                <input type="text" id="deviceName" class="input-field" 
                       placeholder="Device Name">
            </div>
            <div class="input-group">
                <input type="text" id="deviceCommand" class="input-field" 
                       placeholder="Custom Command (optional)">
            </div>
            <div class="input-group">
                <select id="listSelect" class="input-field">
                    ${lists.map(list => `<option value="${list}">${list}</option>`).join('')}
                </select>
                <button onclick="showNewListDialog()" class="neon-button small">+</button>
            </div>
            <div class="button-group">
                <button onclick="addDevice()" class="neon-button">Add Device</button>
                <button onclick="closeDialog()" class="neon-button danger">Cancel</button>
            </div>
        `;
        
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        
        // Add MAC/OUI validation
        const macInput = document.getElementById('deviceMac');
        const validation = document.getElementById('macValidation');
        macInput.addEventListener('input', () => {
            const value = macInput.value.trim();
            if (MAC_PATTERN.test(value) || OUI_PATTERN.test(value)) {
                validation.textContent = '?';
                validation.className = 'validation-message valid';
            } else {
                validation.textContent = 'Invalid format';
                validation.className = 'validation-message invalid';
            }
        });
    });
}

function showNewListDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'cyber-panel new-list-dialog';
    dialog.innerHTML = `
        <h3 class="cyber-title">Create New List</h3>
        <div class="input-group">
            <input type="text" id="newListName" class="input-field" 
                   placeholder="List Name">
        </div>
        <div class="button-group">
            <button onclick="createNewList()" class="neon-button">Create</button>
            <button onclick="closeNewListDialog()" class="neon-button danger">Cancel</button>
        </div>
    `;
    
    const overlay = document.createElement('div');
    overlay.className = 'overlay new-list-overlay';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
}

function showRestartDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'cyber-panel restart-dialog';
    dialog.innerHTML = `
        <h3 class="cyber-title">Restart?</h3>
        <div class="button-group">
            <button onclick="restartScript()" class="neon-button danger">Yes</button>
            <button onclick="closeDialog()" class="neon-button">Cancel</button>
        </div>
    `;
    
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
}

// Context Menu Setup
function setupContextMenu() {
    const deviceList = document.getElementById('device-list');
    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu cyber-panel';
    contextMenu.style.display = 'none';
    document.body.appendChild(contextMenu);
    
    deviceList.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const deviceEntry = e.target.closest('.device-entry');
        if (!deviceEntry) return;
        
        const macElement = deviceEntry.querySelector('.mac');
        const ouiElement = deviceEntry.querySelector('.oui');
        if (!macElement || !ouiElement) return;
        
        const fullMac = ouiElement.textContent + macElement.textContent;
        
        contextMenu.innerHTML = `
            <div class="menu-item" onclick="removeDevice('${fullMac}')">
                Remove Device
            </div>
            <div class="menu-item" onclick="showIgnoreDialog('${fullMac}')">
                Ignore Device
            </div>
        `;
        
        contextMenu.style.display = 'block';
        contextMenu.style.left = `${e.pageX}px`;
        contextMenu.style.top = `${e.pageY}px`;
    });
    
    document.addEventListener('click', () => {
        contextMenu.style.display = 'none';
    });
}
// Ignore Dialog
function showIgnoreDialog(mac) {
    const dialog = document.createElement('div');
    dialog.className = 'cyber-panel ignore-dialog';
    dialog.innerHTML = `
        <h3 class="cyber-title">Ignore Device</h3>
        <div class="input-group">
            <input type="number" id="ignoreDuration" class="input-field" 
                   placeholder="Duration (minutes)" min="1" value="60">
        </div>
        <div class="button-group">
            <button onclick="ignoreDevice('${mac}')" class="neon-button">Ignore</button>
            <button onclick="closeDialog()" class="neon-button danger">Cancel</button>
        </div>
    `;
    
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
}

// API Functions
async function fetchLists() {
    try {
        const response = await fetch('/api/lists');
        return await response.json();
    } catch (error) {
        console.error('Error fetching lists:', error);
        showNotification('Failed to fetch lists', 'error');
        return [];
    }
}

async function addDevice() {
    const mac = document.getElementById('deviceMac').value.trim();
    const name = document.getElementById('deviceName').value.trim();
    let command = document.getElementById('deviceCommand').value.trim();
    const list = document.getElementById('listSelect').value;
    
    if (!mac || !name) {
        showNotification('MAC/OUI and Name are required', 'error');
        return;
    }
    
    if (!(MAC_PATTERN.test(mac) || OUI_PATTERN.test(mac))) {
        showNotification('Invalid MAC/OUI format', 'error');
        return;
    }
    
    // Use default command if none provided
    if (!command) {
        command = `2|${name} |[255,0,0]|0.1|/home/pi/notifications/alert04.mp3|0" | nc -U /mnt/ram/sense_hat_socket`;
    }
    
    try {
        const response = await fetch('/api/add-device', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ mac, name, command, list })
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            showNotification('Device added successfully');
            closeDialog();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error adding device:', error);
        showNotification('Failed to add device', 'error');
    }
}

async function createNewList() {
    const listName = document.getElementById('newListName').value.trim();
    if (!listName) {
        showNotification('List name is required', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/create-list', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: listName })
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            showNotification('List created successfully');
            closeNewListDialog();
            // Refresh lists in select dropdown
            const lists = await fetchLists();
            const select = document.getElementById('listSelect');
            select.innerHTML = lists.map(list => 
                `<option value="${list}">${list}</option>`
            ).join('');
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error creating list:', error);
        showNotification('Failed to create list', 'error');
    }
}

async function restartScript() {
    try {
        // Show a loading notification
        showNotification('Initiating restart...', 'warning');
        
        const response = await fetch('/api/restart', {
            method: 'POST'
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            showNotification('Script is restarting, please wait...', 'warning');
            
            // Wait for script to restart and try to reconnect
            let attempts = 0;
            const maxAttempts = 30; // Try for 30 seconds
            const checkConnection = setInterval(async () => {
                try {
                    const response = await fetch('/api/status', {
                        // Add cache-busting parameter
                        headers: {
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache'
                        }
                    });
                    
                    if (response.ok) {
                        clearInterval(checkConnection);
                        showNotification('Script restarted successfully!');
                        window.location.reload();
                    } else {
                        attempts++;
                        if (attempts >= maxAttempts) {
                            clearInterval(checkConnection);
                            showNotification('Script may need manual restart', 'error');
                        }
                    }
                } catch (error) {
                    attempts++;
                    if (attempts >= maxAttempts) {
                        clearInterval(checkConnection);
                        showNotification('Script may need manual restart', 'error');
                    }
                }
            }, 1000); // Check every second
        } else {
            showNotification('Failed to restart script: ' + (data.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error restarting script:', error);
        showNotification('Failed to restart script. Check console for details.', 'error');
    }
}

// Ignore Device Function
async function ignoreDevice(mac) {
    const duration = document.getElementById('ignoreDuration').value;
    
    if (!duration || duration < 1) {
        showNotification('Please enter a valid duration', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/ignore', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                mac: mac,
                duration: parseInt(duration)
            })
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            showNotification(`Device ${mac} ignored for ${duration} minutes`);
            closeDialog();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error ignoring device:', error);
        showNotification('Failed to ignore device', 'error');
    }
}

// List Management
function updateDeviceList() {
    if (isPaused) return;
    
    fetch('/api/devices')
        .then(response => response.json())
        .then(devices => {
            const newLogs = new Set(devices);
            
            if (hasChanges(newLogs)) {
                checkScrollPosition();
                
                const fragment = document.createDocumentFragment();
                devices.forEach(device => {
                    const entryElement = createDeviceEntry(device);
                    if (entryElement) {
                        fragment.appendChild(entryElement);
                    }
                });
                
                deviceList.innerHTML = '';
                deviceList.appendChild(fragment);
                
                restoreScrollPosition();
                currentLogs = newLogs;
            }
        })
        .catch(error => {
            console.error('Error fetching devices:', error);
            showNotification('Failed to update device list', 'error');
        });
}

// Scroll Management
function checkScrollPosition() {
    isScrolledToBottom = deviceList.scrollHeight - deviceList.clientHeight <= deviceList.scrollTop + 1;
    lastScrollPosition = deviceList.scrollTop;
}

function restoreScrollPosition() {
    if (isScrolledToBottom) {
        deviceList.scrollTop = deviceList.scrollHeight;
    } else {
        deviceList.scrollTop = lastScrollPosition;
    }
}

function hasChanges(newLogs) {
    if (newLogs.size !== currentLogs.size) return true;
    for (let log of newLogs) {
        if (!currentLogs.has(log)) return true;
    }
    return false;
}

// Status Management
async function updateStatus() {
    try {
        const response = await fetch('/api/status');
        if (!response.ok) return;
        
        const data = await response.json();
        
        // Update cycle count
        serverCycleCount = data.cycle_count;
        cycleCounter.textContent = serverCycleCount.toString().padStart(5, '0');
        
        // Update interface status
        const statusDot = document.querySelector('.status-dot');
        const statusText = document.querySelector('.status-text');
        
        if (statusDot && statusText) {
            statusDot.className = `status-dot ${data.interface_status ? 'active' : 'inactive'}`;
            statusText.textContent = data.interface_status ? 'ACTIVE' : 'DOWN';
        }

        // Update channel display
        const channelInfo = document.getElementById('channel-info');
        if (channelInfo) {
            let channelText = [];
            if (data.channels['2.4GHz'].length > 0) {
                channelText.push(`2.4GHz: ${data.channels['2.4GHz'].sort((a,b) => a-b).join(',')}`);
            }
            if (data.channels['5GHz'].length > 0) {
                channelText.push(`5GHz: ${data.channels['5GHz'].sort((a,b) => a-b).join(',')}`);
            }
            channelInfo.textContent = channelText.join(' | ') || 'No channels selected';
        }
        
        // Update capture time display
        const captureTimeElement = document.getElementById('capture-time');
        if (captureTimeElement) {
            captureTimeElement.textContent = data.capture_time;
        }
    } catch (error) {
        console.error('Error updating status:', error);
    }
}

// Control Actions
async function togglePause() {
    try {
        const response = await fetch('/api/pause', {
            method: 'POST'
        });
        const data = await response.json();
        isPaused = data.paused;
        updateStatusIndicators();
        
        showNotification(isPaused ? 'Monitoring paused' : 'Monitoring resumed');
    } catch (error) {
        console.error('Error toggling pause:', error);
        showNotification('Failed to toggle pause state', 'error');
    }
}

async function clearLogs() {
    try {
        const response = await fetch('/api/clear-log', {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.status === 'success') {
            deviceList.innerHTML = '';
            currentLogs.clear();
            showNotification('Logs cleared');
        } else {
            showNotification('Failed to clear logs', 'error');
        }
    } catch (error) {
        console.error('Error clearing logs:', error);
showNotification('Failed to clear logs', 'error');
    }
}

// Device Removal
async function removeDevice(mac) {
    try {
        const response = await fetch('/api/remove-device', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ mac })
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            showNotification('Device removed successfully');
            updateDeviceList();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Error removing device:', error);
        showNotification('Failed to remove device', 'error');
    }
}

// Status Indicators
function updateStatusIndicators() {
    monitorStatus.textContent = isPaused ? 'PAUSED' : 'RUNNING';
    monitorStatus.className = isPaused ? 'status-value paused' : 'status-value';
    const pauseBtn = document.getElementById('pause-btn');
    pauseBtn.querySelector('.button-text').textContent = isPaused ? 'RESUME' : 'PAUSE';
    pauseBtn.className = isPaused ? 'neon-button paused' : 'neon-button';
}

// Notifications
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // Remove existing notifications
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(notif => {
        if (notif !== notification) {
            notif.remove();
        }
    });
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Utility Functions
function closeDialog() {
    const overlay = document.querySelector('.overlay');
    if (overlay) {
        overlay.remove();
    }
}

function closeNewListDialog() {
    const overlay = document.querySelector('.new-list-overlay');
    if (overlay) {
        overlay.remove();
    }
}

function initializeSettings() {
    // Initialize channel grids
    const channels2G = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const channels5G = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 149, 153, 157, 161, 165];
    loadWirelessInterfaces();
    
    const grid2G = document.getElementById('channels-2ghz');
    const grid5G = document.getElementById('channels-5ghz');
    
    if (!grid2G || !grid5G) {
        console.error('Channel grid elements not found');
        return;
    }
    
    grid2G.innerHTML = '';  // Clear existing content
    grid5G.innerHTML = '';  // Clear existing content
    
    channels2G.forEach(channel => {
        const div = document.createElement('div');
        div.className = 'channel-checkbox';
        div.innerHTML = `
            <input type="checkbox" id="ch-2g-${channel}" value="${channel}">
            <label for="ch-2g-${channel}">${channel}</label>
        `;
        grid2G.appendChild(div);
    });
    
    channels5G.forEach(channel => {
        const div = document.createElement('div');
        div.className = 'channel-checkbox';
        div.innerHTML = `
            <input type="checkbox" id="ch-5g-${channel}" value="${channel}">
            <label for="ch-5g-${channel}">${channel}</label>
        `;
        grid5G.appendChild(div);
    });

    // Set default channels
    [1, 6, 11].forEach(ch => {
        const checkbox = document.getElementById(`ch-2g-${ch}`);
        if (checkbox) checkbox.checked = true;
    });
    
    [44, 52, 100, 149, 157, 161].forEach(ch => {
        const checkbox = document.getElementById(`ch-5g-${ch}`);
        if (checkbox) checkbox.checked = true;
    });

    // Add event listeners for settings controls
    const band2g = document.getElementById('band-2ghz');
    const band5g = document.getElementById('band-5ghz');
    const scanApplyBtn = document.getElementById('scan-apply');
    
    if (band2g) {
        band2g.addEventListener('change', function() {
            const grid = document.getElementById('channels-2ghz');
            if (grid) grid.style.opacity = this.checked ? '1' : '0.5';
        });
    }
    
    if (band5g) {
        band5g.addEventListener('change', function() {
            const grid = document.getElementById('channels-5ghz');
            if (grid) grid.style.opacity = this.checked ? '1' : '0.5';
        });
    }
    
    if (scanApplyBtn) {
        scanApplyBtn.addEventListener('click', applyScanSettings);
    }

    // Interface control listeners
    const interfaceApplyBtn = document.getElementById('interface-apply');
    if (interfaceApplyBtn) {
        interfaceApplyBtn.addEventListener('click', applyInterfaceSettings);
    }

    // Reset button listener
    const resetBtn = document.getElementById('settings-reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetSettings);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const controlGroup = document.querySelector('.control-group');
    if (controlGroup) controlGroup.innerHTML = '';
    
    addControlButtons();
    setupContextMenu();
    updateDeviceList();
    updateStatusIndicators();
    updateConfigInfo();
    
    const deviceList = document.getElementById('device-list');
    if (deviceList) {
        deviceList.addEventListener('scroll', checkScrollPosition);
    }

    initializeTabs();
    initializeSettings(); // Add this line
    fetchListStatus();
    loadInitialConfig();

    // Add periodic updates
    setInterval(fetchListStatus, 30000);
    setInterval(updateStatus, 2000);
    setInterval(updateDeviceList, 2000);
    setInterval(updateConfigInfo, 30000);
});


async function applySettings() {
    try {
        const settings = {
            interface: document.getElementById('interface-select')?.value || 'wlan0',
            captureTime: parseInt(document.getElementById('capture-time-input')?.value || '13'),
            band2G: document.getElementById('band-2ghz')?.checked || false,
            band5G: document.getElementById('band-5ghz')?.checked || false,
            channels2G: Array.from(document.getElementById('channels-2ghz')?.querySelectorAll('input:checked') || [])
                .map(cb => parseInt(cb.value)),
            channels5G: Array.from(document.getElementById('channels-5ghz')?.querySelectorAll('input:checked') || [])
                .map(cb => parseInt(cb.value))
        };

        const response = await fetch('/api/apply-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        
        const result = await response.json();
        if (result.status === 'success') {
            showNotification('Settings applied successfully. Restarting service...');
            await updateChannelDisplay();
            setTimeout(() => window.location.reload(), 5000);
        } else if (result.message) {
            showNotification(result.message, 'error');
        }
    } catch (error) {
        console.error('Error applying settings:', error);
        showNotification('Failed to apply settings. Please try again.', 'error');
    }
}

async function resetSettings() {
    try {
        const response = await fetch('/api/reset-settings');
        const result = await response.json();
        
        if (result.status === 'success') {
            showNotification('Settings reset to defaults');
            setTimeout(() => window.location.reload(), 2000);
        } else {
            showNotification('Failed to reset settings', 'error');
        }
    } catch (error) {
        showNotification('Error resetting settings', 'error');
        console.error('Error:', error);
    }
}

async function toggleInterface(action) {
    const interface = document.getElementById('interface-select')?.value || 'wlan0';
    try {
        const response = await fetch('/api/toggle-interface', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ interface, action })
        });
        
        const result = await response.json();
        if (result.status === 'success') {
            showNotification(`Interface ${interface} ${action === 'up' ? 'enabled' : 'disabled'}`);
            updateInterfaceStatus();
        } else {
            showNotification(result.message || `Failed to ${action} interface`, 'error');
        }
    } catch (error) {
        showNotification(`Error toggling interface ${interface}`, 'error');
        console.error('Error:', error);
    }
}

async function updateChannelDisplay() {
    try {
        const response = await fetch('/api/current-settings');
        if (!response.ok) return; // Silently fail if request fails
        
        const data = await response.json();
        if (data.status === 'success') {
            const settings = data.settings;
            const channelInfo = document.getElementById('channel-info');
            if (!channelInfo) return;
            
            let channelText = [];
            
            if (settings.band2G && settings.channels2G.length > 0) {
                channelText.push(`2.4GHz: ${settings.channels2G.sort((a,b) => a-b).join(',')}`);
            }
            
            if (settings.band5G && settings.channels5G.length > 0) {
                channelText.push(`5GHz: ${settings.channels5G.sort((a,b) => a-b).join(',')}`);
            }
            
            channelInfo.textContent = channelText.join(' | ') || 'No channels selected';
        }
    } catch (error) {
        console.error('Error updating channel display:', error);
        // Don't show notification for update errors
    }
}

async function updateConfigInfo() {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();
        updateConfigDisplay(config);
    } catch (error) {
        console.error('Error fetching config:', error);
        showNotification('Failed to update configuration', 'error');
    }
}

function updateConfigDisplay(config) {
    // Update capture time display
    const captureTimeElement = document.getElementById('capture-time');
    if (captureTimeElement) {
        captureTimeElement.textContent = config.capture_time;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const controlGroup = document.querySelector('.control-group');
    controlGroup.innerHTML = '';
    
    addControlButtons();
    setupContextMenu();
    updateDeviceList();
    updateStatusIndicators();
    updateConfigInfo(); // Add this line
    
    deviceList.addEventListener('scroll', checkScrollPosition);

    initializeTabs();
    fetchListStatus();
    loadInitialConfig();

    // Add periodic updates
    setInterval(fetchListStatus, 30000);
    
});

function updateChannelDisplay(channels) {
    const channelInfo = document.getElementById('channel-info');
    const channelText = `2.4GHz: ${channels['2.4GHz'].join(',')} | 5GHz: ${channels['5GHz'].join(',')}`;
    channelInfo.textContent = channelText;
}

// Regular Updates
setInterval(updateStatus, 2000);
setInterval(updateDeviceList, 2000);
setInterval(updateConfigInfo, 30000); 

// Window Event Handlers
window.addEventListener('focus', () => {
    updateDeviceList();
});

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        updateDeviceList();
    }
});

// Error boundary
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    showNotification('An error occurred. Check console for details.', 'error');
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (!isPaused) {
        fetch('/api/pause', { method: 'POST' });
    }
});

