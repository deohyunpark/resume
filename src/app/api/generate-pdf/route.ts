import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';

export const runtime = 'nodejs';
export const maxDuration = 60;

const CHROMIUM_PACK_URL =
    process.env.CHROMIUM_REMOTE_EXEC_PATH ??
    'https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar';

let cachedExecutablePath: string | null = null;
let chromiumDownloadPromise: Promise<string> | null = null;

function resolveBaseUrl(): string {
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
        return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    }
    if (process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL}`;
    }
    return `http://localhost:${process.env.PORT || 3000}`;
}

async function getChromiumExecutablePath(): Promise<string> {
    if (cachedExecutablePath) {
        return cachedExecutablePath;
    }

    if (!chromiumDownloadPromise) {
        chromiumDownloadPromise = (async () => {
            const chromium = (await import('@sparticuz/chromium-min')).default;
            chromium.setGraphicsMode = false;
            const path = await chromium.executablePath(CHROMIUM_PACK_URL);
            cachedExecutablePath = path;
            return path;
        })().catch((error) => {
            chromiumDownloadPromise = null;
            throw error;
        });
    }

    return chromiumDownloadPromise;
}

async function launchBrowserOnVercel() {
    const chromium = (await import('@sparticuz/chromium-min')).default;
    chromium.setGraphicsMode = false;
    const executablePath = await getChromiumExecutablePath();

    console.log('Using @sparticuz/chromium-min from:', CHROMIUM_PACK_URL);
    console.log('Chromium executable:', executablePath);
    console.log('LD_LIBRARY_PATH:', process.env.LD_LIBRARY_PATH ?? '(unset)');

    return puppeteer.launch({
        args: puppeteer.defaultArgs({
            args: chromium.args,
            headless: 'shell',
        }),
        executablePath,
        headless: 'shell',
    });
}

function resolveLocalChromePath(): string {
    if (process.platform === 'win32') {
        const possiblePaths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            `C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
        ];

        for (const path of possiblePaths) {
            try {
                execSync(`if exist "${path}" echo found`, { encoding: 'utf8', shell: 'cmd' });
                return path;
            } catch {
                // try next path
            }
        }
    } else {
        try {
            return execSync(
                'which google-chrome-stable || which google-chrome || which chromium || which chromium-browser',
                { encoding: 'utf8' }
            ).trim();
        } catch {
            const possiblePaths = [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Chromium.app/Contents/MacOS/Chromium',
            ];

            for (const path of possiblePaths) {
                try {
                    execSync(`test -f "${path}"`, { encoding: 'utf8' });
                    return path;
                } catch {
                    // try next path
                }
            }
        }
    }

    throw new Error('Chrome executable not found. Please install Google Chrome or Chromium.');
}

async function launchBrowser() {
    if (process.env.VERCEL) {
        try {
            return await launchBrowserOnVercel();
        } catch (chromiumError) {
            console.error(
                '@sparticuz/chromium-min failed:',
                chromiumError instanceof Error ? chromiumError.stack : chromiumError
            );
            throw chromiumError;
        }
    }

    const executablePath = resolveLocalChromePath();
    console.log('Using local Chrome at:', executablePath);

    return puppeteer.launch({
        executablePath,
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
        ],
    });
}

export async function POST(_request: NextRequest) {
    console.log('PDF generation started');

    try {
        const browser = await launchBrowser();
        const page = await browser.newPage();
        const targetUrl = `${resolveBaseUrl()}/`;

        console.log('Navigating to:', targetUrl);
        await page.goto(targetUrl, {
            waitUntil: 'networkidle2',
            timeout: 45000,
        });
        console.log('Page loaded successfully');

        await page.evaluate(() => {
            document.body.classList.add('pdf-mode');

            const container = document.querySelector('.container') as HTMLElement;
            if (container) {
                container.classList.add('pdf-mobile-layout');
                container.style.cssText = 'column-count: 2; column-gap: 3rem; column-fill: auto;';
            }

            const personalHeader = document.querySelector(
                '[style*="display: flex"][style*="justify-content: space-between"]'
            ) as HTMLElement;
            if (personalHeader) {
                personalHeader.classList.add('personal-info-header');
            }

            document.querySelectorAll('.pdf-download-button, .pdf-link-button').forEach((button) => {
                (button as HTMLElement).style.display = 'none';
            });

            const pdfButtonSection = document.querySelector('.center-section') as HTMLElement;
            if (pdfButtonSection) {
                const sectionText = pdfButtonSection.querySelector('p');
                if (sectionText?.textContent?.includes('PDF 버전으로 이력서를 다운로드하세요')) {
                    pdfButtonSection.style.display = 'none';
                }
            }
        });

        console.log('Generating PDF...');
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '2cm',
                bottom: '2cm',
                left: '1cm',
                right: '1cm',
            },
            displayHeaderFooter: false,
        });
        console.log('PDF generated successfully, size:', pdf.length, 'bytes');

        await browser.close();

        return new Response(Buffer.from(pdf), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename="resume.pdf"',
            },
        });
    } catch (error) {
        console.error('PDF generation failed:', error);

        return NextResponse.json(
            {
                error: 'PDF generation failed',
                message: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}
