#!/usr/bin/env python3

import subprocess
import time
import os
import signal
import sys
from datetime import datetime, timedelta
import argparse
from colorama import init, Fore, Style
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import threading
import queue
import re
import atexit
import logging
from logging.config import dictConfig
import json

LISTS_CONFIG_FILE = '/home/pi/oui/lists_config.json'


# Initialize colorama and Flask
init(autoreset=True)
app = Flask(__name__, static_folder='static')
CORS(app)

# Global variables and constants
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, 'detected_macs.log')
device_queue = queue.Queue()
stop_flag = False
is_paused = False
cycle_count = 0
interface_status = True
ignored_devices = {}
last_alerts = {}
ALERT_COOLDOWN = 60
args = None
mac_entries = {}
verbose_mode = False
ignored_devices = {}
last_alerts = {}
ALERT_COOLDOWN = 60


def load_lists_config():
    if os.path.exists(LISTS_CONFIG_FILE):
        with open(LISTS_CONFIG_FILE, 'r') as f:
            return json.load(f)
    return {'active': [], 'inactive': []}

def save_lists_config(config):
    with open(LISTS_CONFIG_FILE, 'w') as f:
        json.dump(config, f)



def clear_line():
    """Clear the current line in terminal"""
    print('\r\033[K', end='', flush=True)

def print_status(message, color=Fore.WHITE):
    """Print status message with proper formatting"""
    clear_line()
    print(f"{color}{message}{Style.RESET_ALL}", flush=True)

def cleanup_on_exit():
    """Cleanup function to be called on script exit"""
    cleanup_files()
    subprocess.run(['sudo', 'pkill', '-f', 'airodump-ng'], check=False)
atexit.register(cleanup_on_exit)

def log_detection(mac: str, name: str, source_file: str, channel: str = "unknown"):
    """Log detected device with specified format including channel"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M')
    list_name = os.path.basename(source_file)
    
    log_entry = f"[{timestamp}] | {mac} | {name} | Ch: {channel} | List: {list_name}"
    
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(log_entry + "\n")
        
        device_queue.put({
            'timestamp': timestamp,
            'mac': mac,
            'name': name,
            'channel': channel,
            'list': list_name
        })
        
        clear_line()
        print_status(log_entry, Fore.GREEN)
        
    except Exception as e:
        clear_line()
        print_status(f"Error logging detection: {e}", Fore.RED)

def extract_channel(csv_line: str) -> str:
    """Extract channel number from CSV line"""
    try:
        parts = csv_line.split(',')
        if len(parts) >= 4:
            channel = parts[3].strip()
            return channel if channel else "unknown"
    except:
        pass
    return "unknown"

def check_wlan1mon_exists() -> bool:
    """Check if wlan1mon interface exists and is in monitor mode"""
    try:
        result = subprocess.run(['iwconfig', 'wlan1mon'], capture_output=True, text=True)
        if "Mode:Monitor" in result.stdout:
            print_status("wlan1mon interface exists in monitor mode", Fore.GREEN)
            return True
        return False
    except subprocess.CalledProcessError:
        return False

def cleanup_files():
    """Clean up temporary files"""
    subprocess.run(['sudo', 'rm', '-f', '/mnt/ram/OUI-Prox-01.csv'], check=True)
    subprocess.run(['sudo', 'rm', '-f', '/mnt/ram/OUI-Prox-*.csv'], check=True)
    subprocess.run(['sudo', 'rm', '-f', '/mnt/ram/OUI-Prox-*.cap'], check=True)

def setup_interface(interface="wlan1mon"):
    """Setup wireless interface in monitor mode"""
    if not check_wlan1mon_exists():
        print_status(f"Setting up {interface}...", Fore.YELLOW)
        subprocess.run(['sudo', 'ifconfig', interface, 'down'], check=True)
        subprocess.run(['sudo', 'airmon-ng', 'start', 'wlan1'], check=True)
        time.sleep(2)

def find_full_mac(oui: str, csv_content: list) -> str:
    """Find full MAC address for an OUI in CSV content with strict matching"""
    oui_clean = oui.replace(':', '').upper()
    
    for line in csv_content:
        parts = line.split(',')
        if not parts:
            continue
            
        csv_mac = parts[0].strip().replace(':', '').upper()
        
        if len(csv_mac) >= 6 and csv_mac.startswith(oui_clean[:6]):
            formatted_mac = ':'.join([csv_mac[i:i+2] for i in range(0, 12, 2)])
            if verbose_mode:
                print_status(f"DEBUG: OUI match found - OUI: {oui}, Full MAC: {formatted_mac}", Fore.CYAN)
            return formatted_mac
    
    if verbose_mode:
        print_status(f"DEBUG: No full MAC found for OUI: {oui}", Fore.YELLOW)
    return None

def execute_command(command: str):
    """Execute a shell command safely"""
    try:
        clear_line()
        print_status(f"Executing command: {command}", Fore.YELLOW)
        subprocess.run(command, shell=True, check=True)
    except subprocess.CalledProcessError as e:
        clear_line()
        print_status(f"Command execution error: {e}", Fore.RED)

def add_ignore(mac: str, duration_minutes: int):
    """Add a device to ignore list"""
    until_time = datetime.now() + timedelta(minutes=duration_minutes)
    oui = mac[:8] if len(mac) >= 8 else mac
    ignored_devices[mac] = {
        'until': until_time,
        'oui': oui
    }
    print_status(f"Ignoring {mac} (OUI: {oui}) until {until_time.strftime('%Y-%m-%d %H:%M')}", Fore.YELLOW)

def clean_expired_ignores():
    """Remove expired entries from ignore list"""
    now = datetime.now()
    expired = [mac for mac, data in ignored_devices.items() if data['until'] <= now]
    for mac in expired:
        print_status(f"Ignore period expired for {mac}", Fore.YELLOW)
        ignored_devices.pop(mac)

def can_alert(mac: str) -> bool:
    """Check if we should alert for this device based on cooldown"""
    now = datetime.now()
    if mac in last_alerts:
        if (now - last_alerts[mac]).total_seconds() < ALERT_COOLDOWN:
            return False
    last_alerts[mac] = now
    return True

def check_mac_match(line: str, mac_entries: dict, csv_content: list) -> list:
    matches = []
    line = line.upper()
    
    clean_expired_ignores()  # Add this line
    
    # Add this check after clean_expired_ignores
    for mac, data in ignored_devices.items():
        if mac in line or data['oui'] in line:
            return []
            
    
    parts = [part.strip() for part in re.split(r'[,\s]+', line) if part.strip()]
    
    mac_pattern = re.compile(r'(?:[0-9A-F]{2}[:-]){5}(?:[0-9A-F]{2})')
    found_macs = [mac.upper() for mac in mac_pattern.findall(line)]
    
    if verbose_mode:
        print_status(f"DEBUG: Found MACs in line: {found_macs}", Fore.CYAN)
    
    for mac_pattern, entry in mac_entries.items():
        mac_pattern = mac_pattern.upper()
        if verbose_mode:
            print_status(f"DEBUG: Checking pattern: {mac_pattern}", Fore.CYAN)
        
        if len(mac_pattern) == 17:
            if mac_pattern in found_macs:
                if verbose_mode:
                    print_status(f"DEBUG: Full MAC match found: {mac_pattern}", Fore.CYAN)
                if can_alert(mac_pattern):
                    matches.append((entry['name'], mac_pattern, entry['command'], entry['source_file']))
        
        elif len(mac_pattern) == 8:
            oui_clean = mac_pattern[:8].replace(':', '').upper()
            for found_mac in found_macs:
                found_mac_clean = found_mac.replace(':', '').upper()
                if found_mac_clean.startswith(oui_clean[:6]):
                    if can_alert(found_mac):
                        if verbose_mode:
                            print_status(f"DEBUG: OUI match found - Pattern: {mac_pattern}, MAC: {found_mac}", Fore.CYAN)
                        matches.append((entry['name'], found_mac, entry['command'], entry['source_file']))
    
    return matches

def read_mac_list(filenames: list) -> dict:
    """Read MAC/OUI entries from files with proper space handling"""
    mac_entries = {}
    for filename in filenames:
        try:
            with open(filename, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        # Find the first space for MAC
                        first_space_idx = line.find(' ')
                        if first_space_idx == -1:
                            continue
                            
                        mac = line[:first_space_idx].upper()
                        rest = line[first_space_idx + 1:].lstrip()
                        
                        # Find the closing quote of the name
                        if rest.startswith('"'):
                            name_end = rest[1:].find('"')
                            if name_end == -1:
                                continue
                            name = rest[1:name_end + 1]
                            command = rest[name_end + 2:].lstrip()
                        else:
                            # Find the next space for non-quoted names
                            next_space_idx = rest.find(' ')
                            if next_space_idx == -1:
                                continue
                            name = rest[:next_space_idx]
                            command = rest[next_space_idx + 1:].lstrip()
                        
                        mac_entries[mac] = {
                            'name': name,
                            'command': command,
                            'source_file': filename
                        }
                        
        except FileNotFoundError:
            print_status(f"File not found: {filename}", Fore.RED)
    
    return mac_entries

def process_csv(mac_entries: dict):
    """Process CSV file for matches with channel information"""
    try:
        if not os.path.exists('/mnt/ram/OUI-Prox-01.csv'):
            return
            
        clear_line()
        print_status("Scanning CSV for matches...", Fore.CYAN)
                # Build dynamic channel monitoring message
        channels_msg = "Currently monitoring channels:"
        if args.band_2:
            channels_msg += " 1, 6, 11 (2.4GHz)"
        if args.band_5:
            if args.band_2:
                channels_msg += ","
            channels_msg += " 44, 52 (5GHz lower), 100 (5GHz middle), 149, 157, 161 (5GHz upper)"
        print_status(channels_msg, Fore.CYAN)
        
        with open('/mnt/ram/OUI-Prox-01.csv', 'r', errors='ignore') as f:
            csv_content = f.readlines()
            
        found_matches = False
        for line in csv_content:
            matches = check_mac_match(line, mac_entries, csv_content)
            if matches:
                found_matches = True
                channel = extract_channel(line)
                for name, full_mac, command, source_file in matches:
                    log_detection(full_mac, name, source_file, channel)
                    time.sleep(0.1)
                    if command:
                        execute_command(command)
                        time.sleep(1)
        
        if not found_matches:
            clear_line()
            print_status("No matches found in this scan cycle", Fore.YELLOW)
            
    except Exception as e:
        clear_line()
        print_status(f"Error processing CSV: {e}", Fore.RED)

def process_cleanup(process):
    """Clean up airodump process with escalating kill signals"""
    try:
        # First attempt: Normal termination
        process.terminate()
        
        # Second attempt: SIGHUP
        if process.poll() is None:
            os.kill(process.pid, signal.SIGHUP)
            
        # Third attempt: SIGKILL
        if process.poll() is None:
            process.kill()
            
        # Final attempt: Kill all remaining airodump processes
        if process.poll() is None:
            subprocess.run(['sudo', 'killall', '-9', 'airodump-ng'], check=False)
            
    except Exception as e:
        print_status(f"Error during process cleanup: {e}", Fore.RED)
    finally:
        # Double-check for any remaining airodump processes
        subprocess.run(['sudo', 'pkill', '-9', '-f', 'airodump-ng'], check=False)

def get_band_and_channels(args):
    """Determine band mode and channels based on command line arguments"""
    if not args.band_2 and not args.band_5:
        print_status("Error: At least one band (-2 or -5) must be specified", Fore.RED)
        sys.exit(1)
        
    channels = []
    if args.band_2:
        channels.extend(['1', '6', '11'])
    if args.band_5:
        channels.extend(['44', '52', '100', '149', '157', '161'])
        
    if args.band_2 and args.band_5:
        band_mode = 'abg'
    elif args.band_5:
        band_mode = 'a'
    else:  # args.band_2
        band_mode = 'g'
        
    return band_mode, ','.join(channels)

def monitoring_loop(args):
    """Main monitoring loop with airodump configuration display"""
    global stop_flag, is_paused, cycle_count, interface_status, mac_entries
    
    if not setup_wireless_interface(getattr(args, 'custom_mac', None)):
        sys.exit(1)
    
    band_mode, channels = get_band_and_channels(args)
    
    # Display configuration with proper formatting
    clear_line()
    print_status("=== Airodump-ng Configuration ===", Fore.CYAN)
    print_status(f"Band mode: {band_mode}")
    print_status("Monitored channels:")
    if args.band_2:
        print_status("  - 2.4GHz: 1, 6, 11 (main channels)")
    if args.band_5:
        print_status("  - 5GHz lower band: 44, 52")
        print_status("  - 5GHz middle band: 100")
        print_status("  - 5GHz upper band: 149, 157, 161")
    print_status(f"Capture time per cycle: {args.capture_time} seconds")
    print_status("Output format: CSV (stored in /mnt/ram/)")
    
    while not stop_flag:
        if not is_paused:
            try:
                cycle_count += 1
                clear_line()
                print_status(f"=== Cycle {cycle_count} ===", Fore.CYAN)
                
                if cycle_count % 10 == 0:
                    interface_status = check_wlan1mon_exists()
                    if not interface_status:
                        print_status("Warning: wlan1mon interface is down", Fore.RED)
                        if not restart_wireless_interface():
                            print_status("Failed to restart wireless interface", Fore.RED)
                
                if cycle_count % 4000 == 0:
                    print_status(f"=== Cycle {cycle_count}: Performing wireless interface restart ===", Fore.YELLOW)
                    restart_wireless_interface()
                
                cleanup_files()
                process = subprocess.Popen([
                    'sudo', 'airodump-ng',
                    '--output-format', 'csv',
                    '-w', '/mnt/ram/OUI-Prox',
                    '--band', band_mode,
                    '-c', channels,
                    'wlan1mon'
                ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                
                time.sleep(args.capture_time)
                process_cleanup(process)
                process_csv(mac_entries)
                
            except Exception as e:
                clear_line()
                print_status(f"Error in monitoring loop: {e}", Fore.RED)
                time.sleep(5)
            
        time.sleep(1)

def restart_wireless_interface():
    """Restart wireless interface"""
    try:
        print_status("Restarting wireless interface...", Fore.YELLOW)
        subprocess.run(['sudo', 'airmon-ng', 'stop', 'wlan1mon'], check=True)
        time.sleep(2)
        subprocess.run(['sudo', 'airmon-ng', 'start', 'wlan1'], check=True)
        time.sleep(2)
        print_status("Wireless interface restarted successfully", Fore.GREEN)
        return True
    except subprocess.CalledProcessError as e:
        print_status(f"Error restarting wireless interface: {e}", Fore.RED)
        return False

def setup_wireless_interface(custom_mac: str = None):
    """Setup wireless interface with optional custom MAC"""
    if check_wlan1mon_exists():
        print_status("Using existing wlan1mon interface", Fore.GREEN)
        return True
    
    try:
        # Check if wlan1 exists # main wifi addaper
        result = subprocess.run(['iwconfig', 'wlan1'], capture_output=True, text=True)
        if "no such device" in result.stderr.lower():
            error_msg = "4|Wireless Monitor Mode Failed on wlan1... |red|0.1||0"
            subprocess.run(['echo', error_msg, '|', 'nc', 'localhost', '5555'], 
                         shell=True)
            print_status("Error: wlan1mon interface not found", Fore.RED)
            return False

        # Setup monitor mode
        print_status("Setting up monitor mode...", Fore.CYAN)
        subprocess.run(['sudo', 'airmon-ng', 'start', 'wlan1'], check=True)
        time.sleep(2)

        if custom_mac:
            subprocess.run(['sudo', 'ifconfig', 'wlan1', 'down'], check=True)
            subprocess.run(['sudo', 'macchanger', '-m', custom_mac, 'wlan1'], check=True)
        
        subprocess.run(['sudo', 'ifconfig', 'wlan1', 'up'], check=True)
        print_status("Monitor mode setup complete", Fore.GREEN)
        return True

    except subprocess.CalledProcessError as e:
        error_msg = "4|Wireless Monitor Mode Failed on wlan1... |red|0.1||1"
        subprocess.run(['echo', error_msg, '|', 'nc', 'localhost', '5555'], 
                     shell=True)
        print_status(f"Error setting up wireless interface: {e}", Fore.RED)
        return False

# Configure Flask logging
dictConfig({
    'version': 1,
    'formatters': {
        'default': {
            'format': '[%(asctime)s] %(message)s',
            'datefmt': '%Y-%m-%d %H:%M:%S'
        }
    },
    'handlers': {
        'wsgi': {
            'class': 'logging.StreamHandler',
            'stream': 'ext://sys.stdout',
            'formatter': 'default'
        }
    },
    'root': {
        'level': 'INFO',
        'handlers': ['wsgi']
    },
    'loggers': {
        'werkzeug': {
            'level': 'ERROR',  # Only show Flask errors
            'handlers': ['wsgi']
        }
    }
})


def get_all_available_lists():
    """Get all available list files from the directory"""
    lists_dir = '/home/pi/oui/list'
    return [f for f in os.listdir(lists_dir) if os.path.isfile(os.path.join(lists_dir, f))]

def initialize_lists_config():
    """Initialize lists config based on command line arguments"""
    global args
    lists_dir = '/home/pi/oui/list'
    
    # Get all list files from directory
    all_lists = get_all_available_lists()
    
    # Get the basenames of the lists provided in -m argument
    active_lists = [os.path.basename(path) for path in args.mac_list]
    
    # Create inactive lists (all lists minus active ones)
    inactive_lists = list(set(all_lists) - set(active_lists))
    
    # Save configuration
    config = {
        'active': active_lists,
        'inactive': inactive_lists
    }
    save_lists_config(config)
    return config

# Flask routes
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/api/initial-config')
def get_initial_config():
    try:
        lists_dir = '/home/pi/oui/list'
        all_lists = [f for f in os.listdir(lists_dir) if os.path.isfile(os.path.join(lists_dir, f))]
        
        # Get the basenames of the currently loaded lists from args
        active_lists = [os.path.basename(path) for path in args.mac_list]
        inactive_lists = list(set(all_lists) - set(active_lists))
        
        band_mode, channels = get_band_and_channels(args)
        
        return jsonify({
            'lists': {
                'active': active_lists,
                'inactive': inactive_lists
            },
            'config': {
                'capture_time': args.capture_time,
                'band_mode': band_mode,
                'channels': {
                    '2.4GHz': [1, 6, 11] if args.band_2 else [],
                    '5GHz': [44, 52, 100, 149, 157, 161] if args.band_5 else []
                }
            }
        })
    except Exception as e:
        print_status(f"Error getting initial config: {e}", Fore.RED)
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('static', path)

@app.route('/api/status')
def get_status():
    global cycle_count, interface_status
    return jsonify({
        'cycle_count': cycle_count,
        'interface_status': interface_status
    })

@app.route('/api/devices')
def get_devices():
    try:
        devices = []
        with open(LOG_FILE, 'r') as f:
            devices = [line.strip() for line in f.readlines()]
        return jsonify(devices)
    except Exception as e:
        return jsonify([])

@app.route('/api/clear-log', methods=['POST'])
def clear_log():
    try:
        open(LOG_FILE, 'w').close()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/pause', methods=['POST'])
def toggle_pause():
    global is_paused
    is_paused = not is_paused
    return jsonify({'paused': is_paused})

@app.route('/api/ignore', methods=['POST'])
def ignore_device():
    try:
        data = request.json
        if not data:
            return jsonify({
                'status': 'error',
                'message': 'No JSON data received'
            })
        
        mac = data.get('mac', '').upper()
        duration = int(data.get('duration', 60))  # Duration in minutes
        
        if not mac:
            return jsonify({
                'status': 'error',
                'message': 'MAC address required'
            })
            
        if duration < 1:
            return jsonify({
                'status': 'error',
                'message': 'Duration must be at least 1 minute'
            })
        
        add_ignore(mac, duration)
        return jsonify({
            'status': 'success',
            'message': f'Ignoring {mac} for {duration} minutes'
        })
    except Exception as e:
        print_status(f"Error in ignore_device: {e}", Fore.RED)
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/api/ignored')
def get_ignored():
    clean_expired_ignores()
    return jsonify({
        mac: {
            'oui': data['oui'],
            'expires': data['until'].isoformat()
        }
        for mac, data in ignored_devices.items()
    })

@app.route('/api/lists')
def get_lists():
    try:
        lists_dir = '/home/pi/oui/list'
        lists = [f for f in os.listdir(lists_dir) if os.path.isfile(os.path.join(lists_dir, f))]
        return jsonify(lists)
    except Exception as e:
        return jsonify([])

@app.route('/api/add-device', methods=['POST'])
def add_device():
    global mac_entries, args
    try:
        data = request.json
        mac = data['mac']
        name = data['name'].strip()
        
        # Create the command with properly escaped quotes
        msg_command = f'echo "2|{name} Detected |[255,0,0]|0.1|/home/pi/notifications/alert04.mp3 nc -U /mnt/ram/sense_hat_socket'
        
        # Create the entry with the name in quotes and the command
        entry = f'{mac} "{name}" {msg_command}\n'
        
        list_name = data['list']
        list_path = os.path.join('/home/pi/oui/list', list_name)
        
        with open(list_path, 'a') as f:
            print_status(f"Adding entry: {entry.strip()}", Fore.GREEN)
            f.write(entry)
        
        # Reload MAC list after adding new device
        mac_entries = read_mac_list(args.mac_list)
        
        return jsonify({'status': 'success'})
    except Exception as e:
        print_status(f"Error adding device: {e}", Fore.RED)
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/create-list', methods=['POST'])
def create_list():
    try:
        data = request.json
        list_name = data['name']
        list_path = os.path.join('/home/pi/oui/list', list_name)
        
        if os.path.exists(list_path):
            return jsonify({'status': 'error', 'message': 'List already exists'})
            
        with open(list_path, 'w') as f:
            pass  # Create empty file
        
        # Update the mac_list arguments and reload
        global args, mac_entries
        if list_path not in args.mac_list:
            args.mac_list.append(list_path)
            mac_entries = read_mac_list(args.mac_list)
            
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/config')
def get_config():
    band_mode, channels = get_band_and_channels(args)
    channels_list = channels.split(',')
    
    config = {
        'capture_time': args.capture_time,
        'band_mode': band_mode,
        'channels': {
            '2.4GHz': [1, 6, 11] if args.band_2 else [],
            '5GHz': [44, 52, 100, 149, 157, 161] if args.band_5 else []
        }
    }
    return jsonify(config)

@app.route('/api/remove-device', methods=['POST'])
def remove_device():
    try:
        data = request.json
        mac = data.get('mac', '').strip().lower()
        
        if not mac:
            return jsonify({'status': 'error', 'message': 'MAC address required'})
        
        # If we got a full MAC, check if we need to convert to OUI
        input_mac = mac
        if len(mac) == 17:
            # Also check for OUI pattern match
            mac_parts = [mac[:8], mac]  # Try both OUI and full MAC
        else:
            mac_parts = [mac]  # Just try the exact input (OUI)
        
        # Read and update all MAC list files
        removed = False
        for list_file in args.mac_list:
            with open(list_file, 'r') as f:
                lines = f.readlines()
            
            # Filter out the matching MAC/OUI
            new_lines = []
            for line in lines:
                line_parts = line.strip().split(' ', 2)
                if len(line_parts) >= 1:
                    line_mac = line_parts[0].strip().lower()
                    
                    # Check if this line's MAC matches any of our patterns
                    if line_mac not in mac_parts:
                        new_lines.append(line)
                    else:
                        removed = True
                        print_status(f"Removing device with pattern: {line_mac} from {list_file}", Fore.YELLOW)
            
            if removed:  # Only write back if we actually removed something
                with open(list_file, 'w') as f:
                    f.writelines(new_lines)
        
        # Reload MAC list after removing device
        global mac_entries
        mac_entries = read_mac_list(args.mac_list)
        
        if removed:
            return jsonify({'status': 'success', 'message': f'Device {input_mac} removed successfully'})
        else:
            return jsonify({'status': 'error', 'message': f'Device {input_mac} not found in any list'})
            
    except Exception as e:
        print_status(f"Error removing device: {e}", Fore.RED)
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/lists-status')
def get_lists_status():
    try:
        lists_dir = '/home/pi/oui/list'
        all_lists = [f for f in os.listdir(lists_dir) if os.path.isfile(os.path.join(lists_dir, f))]
        
        config = load_lists_config()
        
        # Ensure all lists are accounted for
        active_lists = set(config.get('active', []))
        existing_lists = set(all_lists)
        
        # Add new lists to inactive by default
        inactive_lists = existing_lists - active_lists
        
        # Remove non-existent lists from active
        active_lists = active_lists & existing_lists
        
        # Save updated configuration
        config = {
            'active': list(active_lists),
            'inactive': list(inactive_lists)
        }
        save_lists_config(config)
        
        return jsonify(config)
    except Exception as e:
        print_status(f"Error getting lists status: {e}", Fore.RED)
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/toggle-list', methods=['POST'])
def toggle_list():
    try:
        data = request.json
        list_name = data.get('name')
        active = data.get('active')
        
        if not list_name:
            return jsonify({'status': 'error', 'message': 'List name required'})
            
        config = load_lists_config()
        active_lists = set(config.get('active', []))
        
        if active:
            active_lists.add(list_name)
        else:
            active_lists.discard(list_name)
        
        # Update mac_entries with only active lists
        global mac_entries, args
        active_list_paths = [os.path.join('/home/pi/oui/list', name) for name in active_lists]
        args.mac_list = active_list_paths
        mac_entries = read_mac_list(args.mac_list)
        
        # Save configuration
        lists_dir = '/home/pi/oui/list'
        all_lists = [f for f in os.listdir(lists_dir) if os.path.isfile(os.path.join(lists_dir, f))]
        config = {
            'active': list(active_lists),
            'inactive': list(set(all_lists) - active_lists)
        }
        save_lists_config(config)
        
        return jsonify({'status': 'success'})
    except Exception as e:
        print_status(f"Error toggling list: {e}", Fore.RED)
        return jsonify({'status': 'error', 'message': str(e)})

# Set Flask logging level
app.logger.setLevel(logging.ERROR)

def main():
    global args, mac_entries, verbose_mode
    # Force unbuffered output
    sys.stdout.reconfigure(line_buffering=True)
    
    parser = argparse.ArgumentParser(description='OUI/MAC Address Monitor')
    parser.add_argument('-m', '--mac-list', required=True, nargs='+', help='MAC list files')
    parser.add_argument('-t', '--capture-time', type=int, default=13, help='Capture time in seconds')
    parser.add_argument('-c', '--custom-mac', help='Custom MAC address for wireless interface')
    parser.add_argument('-v', '--verbose', action='store_true', help='Enable verbose debug output')
    parser.add_argument('-2', '--band-2', action='store_true', help='Enable 2.4GHz band (channels 1,6,11)')
    parser.add_argument('-5', '--band-5', action='store_true', help='Enable 5GHz band (channels 44,52,100,149,157,161)')
    args = parser.parse_args()
    initialize_lists_config()

    if not args.band_2 and not args.band_5:
        parser.error("At least one band (-2 or -5) must be specified")

    config = load_lists_config()
    active_lists = config.get('active', [])
    if active_lists:
        args.mac_list = [os.path.join('/home/pi/oui/list', name) for name in active_lists]

    # Initialize mac_entries globally
    mac_entries = read_mac_list(args.mac_list)

    verbose_mode = args.verbose    
    clear_line()
    print_status("=== OUI Detector Starting ===", Fore.GREEN)
    print_status(f"Log file: {LOG_FILE}", Fore.CYAN)
    
    if verbose_mode:
        print_status("Verbose mode enabled", Fore.CYAN)
    
    # Initialize mac_entries globally
    mac_entries = read_mac_list(args.mac_list)
    
    # Create log file if it doesn't exist
    if not os.path.exists(LOG_FILE):
        open(LOG_FILE, 'w').close()
        print_status("Created new log file", Fore.GREEN)
    
    # Start monitoring thread
    monitor_thread = threading.Thread(target=monitoring_loop, args=(args,))
    monitor_thread.daemon = True
    monitor_thread.start()
    
    try:
        # Start Flask server with reduced logging
        print_status("Starting web interface on port 5000...", Fore.CYAN)
        app.run(host='0.0.0.0', port=5000, threaded=True, debug=False)
    except KeyboardInterrupt:
        print_status("\nShutting down...", Fore.YELLOW)
        stop_flag = True
        monitor_thread.join(timeout=2)
        cleanup_files()
        sys.exit(0)
    except Exception as e:
        print_status(f"Error: {e}", Fore.RED)
        stop_flag = True
        monitor_thread.join(timeout=2)
        cleanup_files()
        sys.exit(1)

if __name__ == "__main__":
    main()