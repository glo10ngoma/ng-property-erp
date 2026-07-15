FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./

RUN npm ci --include=dev

COPY . .

RUN npm run build

RUN find /app/dist/templates -maxdepth 4 -type f -print

RUN node -e 'const { chromium } = require("playwright"); console.log(chromium.executablePath())'

RUN CHROMIUM_PATH=$(node -e 'const { chromium } = require("playwright"); process.stdout.write(chromium.executablePath())') && test -x "$CHROMIUM_PATH"

RUN node -e 'const { chromium } = require("playwright"); (async () => { const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }); console.log("CHROMIUM_OK"); await browser.close(); })().catch((error) => { console.error(error); process.exit(1); });'

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "run", "start:prod"]
