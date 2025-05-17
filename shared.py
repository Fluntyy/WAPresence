import threading

# Shared variables
update_interval = 1
format_string = "Listening to [artist] - [title] | [bio]"
current_source = "local" 

# Event to signal updates
source_changed_event = threading.Event() 
settings_updated_event = threading.Event()

# Getter functions
def get_update_interval():
    return update_interval

def get_format_string():
    return format_string

def get_current_source():
    return current_source

# Setter functions
def set_update_interval(value):
    global update_interval
    update_interval = value
    settings_updated_event.set()
    
def set_format_string(value):
    global format_string
    format_string = value
    settings_updated_event.set() 
    

def set_current_source(source):
    global current_source
    if source != current_source:
        current_source = source
        source_changed_event.set()