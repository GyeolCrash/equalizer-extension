import express, { Request, Response } from 'express';

const successRouter = express.Router();

successRouter.get('/', (req: Request, res: Response) => {
    const html = `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Successful</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f7fafc; margin: 0; }
        .card { background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; border-top: 5px solid #48bb78; }
        h1 { color: #2d3748; padding-bottom: 0px; margin-bottom: 10px; }
        p { color: #4a5568; margin-top: 1rem; font-size: 1.1rem; }
        .icon { font-size: 4rem; margin-bottom: 10px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">🎉</div>
        <h1>Payment is completed.</h1>
        <p>Thank you for upgrading to Pro plan.</p>
        <p>You can close this window and return to the extension.</p>
      </div>
      <script>
        setTimeout(() => window.close(), 8000);
      </script>
    </body>
    </html>
  `;
    res.status(200).send(html);
});

export default successRouter;
