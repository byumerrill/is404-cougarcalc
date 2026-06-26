# Enhancements

## FEATURE: log user requests to a csv log file in the repo
1. create a gitignore that will ignore the log directory and the logs inside it
2. create a user-request-log file that the app will write to in APPEND only mode. 
3. Data elements to capture in the log file:
- full date & time of the request
- requesting IP and port
- user input (what equation they requested)
- ask for their nickname in the app and capture it?
4. Format of the csv should look like this (notice the headers)
Timestamp,LocalAddress,LocalPort,RemoteAddress,RemotePort
"2026-06-26 15:34:08","10.37.136.156","3000","10.37.243.81","57188"
"2026-06-26 15:34:08","10.37.136.156","3000","10.37.243.82","57199"

# FEATURE: label on the app indicating hosting environment
have a small label somewhere on the app that gives some indication to where the app is hosted. Ideally this would be dynamically obtained and displayed by the app. The goal is to clearly indicate to the users (in the browser) whether they are using the web app hosted on the laptop ("development environment") or the publicly available ("prod") environment (which could end up being AWS)

# BUGS to fix
When the first thing you try to type is "(", it gets added after the default zero in the calc display like this "0(" but the "(" should replace that default zero. Then whatever you end up submitting returns and ERROR from the calculator since it looks like this: "0(1+1)"