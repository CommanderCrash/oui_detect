# oui_detect

Detects OUI from client and AP using airodump-ng. Make sure you make a ram disk and aouto mount in fstab /mnt/ram
Wifi addapter may need to be adjusted in python script to match your addapter name.
how To:
python3 oui-detect.py --help
usage: oui-detect.py [-h] -m MAC_LIST [MAC_LIST ...] [-t CAPTURE_TIME] [-c CUSTOM_MAC] [-v] [-2] [-5]

OUI/MAC Address Monitor

optional arguments:
  -h, --help            show this help message and exit
  -m MAC_LIST [MAC_LIST ...], --mac-list MAC_LIST [MAC_LIST ...]
                        MAC list files
  -t CAPTURE_TIME, --capture-time CAPTURE_TIME
                        Capture time in seconds
  -c CUSTOM_MAC, --custom-mac CUSTOM_MAC
                        Custom MAC address for wireless interface
  -v, --verbose         Enable verbose debug output
  -2, --band-2          Enable 2.4GHz band (channels 1,6,11)
  -5, --band-5          Enable 5GHz band (channels 44,52,100,149,157,161)


python3 oui-detect.py -t 20 -m list/drones -2 -5
"list" structure:
OUI  Name  Command
