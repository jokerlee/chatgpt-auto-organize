# ChatGPT Auto Organize

A Chrome extension that uses ChatGPT to automatically categorize your conversations into projects.

## How It Works

This extension works directly within the ChatGPT web interface. It requires you to have ChatGPT open and logged in.

1. Collects titles of your uncategorized conversations
2. Sends them to ChatGPT in a temporary chat to analyze and match with your existing projects
3. Shows you the suggested categorizations for review
4. Moves conversations to their matched projects via ChatGPT's internal API

## Features

- **AI Classification** - Uses ChatGPT itself to analyze conversation titles and find the best matching project
- **Preview & Confirm** - Review all suggestions before applying, deselect any you don't want
- **Batch Processing** - Process multiple conversations at once with progress indication
- **Custom Categories** - Define your own category names, or use only existing projects

## Privacy

- All processing happens locally in your browser
- No data is sent to any third-party servers
- The extension only communicates with ChatGPT's servers

## License

MIT
