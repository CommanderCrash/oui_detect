# OUI Detect with webUI

A Python tool that detects OUI (Organizationally Unique Identifier) from clients and access points using airodump-ng.

## Prerequisites

- Create and auto-mount a RAM disk in fstab at `/mnt/ram`
- Ensure your WiFi adapter name matches the one specified in the Python script

## Installation

Adjust your WiFi adapter name in the Python script as needed.

## Usage

Basic command syntax:

python3 oui-detect.py [-h] -m MAC_LIST [MAC_LIST ...] [-t CAPTURE_TIME] [-c CUSTOM_MAC] [-v] [-2] [-5]

## Arguments

-h, --help
    show help message and exit

-m MAC_LIST [MAC_LIST ...], --mac-list MAC_LIST [MAC_LIST ...]
    MAC list files (required)

-t CAPTURE_TIME, --capture-time CAPTURE_TIME
    Capture time in seconds

-c CUSTOM_MAC, --custom-mac CUSTOM_MAC
    Custom MAC address for wireless interface

-v, --verbose
    Enable verbose debug output

-2, --band-2
    Enable 2.4GHz band (channels 1,6,11)

-5, --band-5
    Enable 5GHz band (channels 44,52,100,149,157,161)

## Example

python3 oui-detect.py -t 20 -m list/drones -2 -5
runs for 20 seconds using list drones with -2 2.4ghz and -5 5ghz monitoring.

## List File Structure

The `list` files should follow this format:
OUI  Name  Command

change json file loction in script to match your directory:
LISTS_CONFIG_FILE = '/home/Your_UNAME/oui/lists_config.json'

Go to http://localhost:5000
