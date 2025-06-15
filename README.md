# Quote API

A fork of [LyoSU/quote-api](https://github.com/LyoSU/quote-api) with enhanced features for generating animated quotes in WebP format.

## Features

- Generate static quote images
- Generate animated quote images (WebP format)
- Support for multiple message formats
- Customizable backgrounds and colors
- Support for media attachments (photos, stickers, animations)
- Reply message support
- Multiple emoji brands support

## Installation

```bash
npm install
npm start
```

## API Endpoints

### Static Quote Generation

**POST** `/generate`

Generate static quote images.

### Animated Quote Generation

**POST** `/generate.webm`

Generate animated quote images in WebP format for messages containing animated media.

## Request Format

```json
{
  "botToken": "YOUR_BOT_TOKEN",
  "backgroundColor": "#1a1a2e/#16213e",
  "width": 512,
  "height": 768,
  "scale": 2,
  "emojiBrand": "apple",
  "messages": [
    {
      "from": {
        "id": 123456789,
        "first_name": "John",
        "last_name": "Doe",
        "username": "johndoe",
        "photo": {
          "url": "https://example.com/avatar.jpg"
        }
      },
      "text": "Hello, world!",
      "avatar": true,
      "entities": [
        {
          "type": "bold",
          "offset": 0,
          "length": 5
        }
      ],
      "media": {
        "url": "https://example.com/image.jpg",
        "is_animated": false
      },
      "mediaType": "photo",
      "replyMessage": {
        "name": "Jane",
        "text": "Hi there!",
        "chatId": 987654321,
        "entities": []
      }
    }
  ]
}
```

## Parameters

### Required Parameters

- `messages`: Array of message objects to include in the quote

### Optional Parameters

- `botToken`: Telegram bot token for accessing user avatars
- `backgroundColor`: Background color (hex) or gradient (`#color1/#color2`)
- `width`: Output width in pixels (default: 512)
- `height`: Output height in pixels (default: 768)
- `scale`: Scaling factor (default: 2)
- `emojiBrand`: Emoji style (`apple`, `google`, `twitter`, `blob`)

### Message Object

- `from`: User information object
  - `id`: User ID (number)
  - `first_name`: First name (string)
  - `last_name`: Last name (string, optional)
  - `username`: Username (string, optional)
  - `photo`: Avatar object with `url` property (optional)
- `text`: Message text (string, optional)
- `avatar`: Show user avatar (boolean, default: true)
- `entities`: Text formatting entities (array, optional)
- `media`: Media attachment object (optional)
  - `url`: Media URL (string)
  - `is_animated`: Whether media is animated (boolean)
- `mediaType`: Type of media (`photo`, `sticker`, `animation`)
- `replyMessage`: Reply message object (optional)

### Text Entities

Supported entity types:
- `bold`: Bold text
- `italic`: Italic text
- `underline`: Underlined text
- `strikethrough`: Strikethrough text
- `spoiler`: Spoiler text
- `code`: Monospace text
- `pre`: Preformatted text
- `mention`: @username mentions
- `text_link`: Links
- `custom_emoji`: Custom emojis

## Response Format

### Static Quotes

```json
{
  "image": "base64_encoded_image_data",
  "type": "quote",
  "width": 512,
  "height": 400,
  "ext": "webp"
}
```

### Animated Quotes

```json
{
  "image": "base64_encoded_webp_data",
  "type": "animated",
  "width": 512,
  "height": 600,
  "ext": "webp",
  "isAnimated": true,
  "duration": 3000
}
```

## Example Usage

### Basic Static Quote

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{
      "from": {
        "id": 123456789,
        "first_name": "Alice"
      },
      "text": "Hello, world!",
      "avatar": true
    }]
  }'
```

### Animated Quote with Media

```bash
curl -X POST http://localhost:3000/generate.webm \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{
      "from": {
        "id": 123456789,
        "first_name": "Bob",
        "photo": {
          "url": "https://example.com/avatar.jpg"
        }
      },
      "text": "Check this out!",
      "avatar": true,
      "media": {
        "url": "https://example.com/animation.webm",
        "is_animated": true
      },
      "mediaType": "animation"
    }]
  }'
```

### Quote with Reply

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "backgroundColor": "#1a1a2e",
    "messages": [{
      "from": {
        "id": 123456789,
        "first_name": "Charlie"
      },
      "text": "I agree!",
      "avatar": true,
      "replyMessage": {
        "name": "David",
        "text": "What do you think?",
        "chatId": 987654321
      }
    }]
  }'
```

## Background Colors

You can use solid colors or gradients:

- Solid: `"#1a1a2e"`
- Gradient: `"#1a1a2e/#16213e"`
- Auto-gradient: `"//#1a1a2e"` (generates complementary color)

## Emoji Brands

Supported emoji brands:
- `apple` (default)
- `google`
- `twitter`
- `blob`

## Error Handling

The API returns appropriate HTTP status codes:

- `200`: Success
- `400`: Bad Request (invalid parameters)
- `500`: Internal Server Error

Error responses include details:

```json
{
  "error": "error_code",
  "message": "Error description"
}
```

## Notes

- For animated quotes, use the `/generate.webm` endpoint
- Animated media is automatically detected and processed
- The API supports both static and animated WebP output
- Maximum recommended scale factor is 20
- Media files are automatically downloaded and processed
- Custom emojis require a valid bot token

## Dependencies

- Node.js
- Canvas
- Sharp
- FFmpeg (for animated content)
- Various image processing libraries

## License

This project is a fork of [LyoSU/quote-api](https://github.com/LyoSU/quote-api).
