## Creating a Spotify Developer Application for WAPresence

To use the Spotify integration, you need to create your own application in the Spotify Developer Dashboard. Follow these steps.

### 1\. Go to the Spotify Developer Dashboard

First, navigate to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in with your Spotify account.

### 2\. Create a New App

1.  Click the **"Create app"** button.
2.  Fill out the application details as follows:
      * **App name:** `WAPresence`
      * **App description:** `Show your music information in your WhatsApp bio.`
      * **Redirect URIs:** `http://localhost:6969/callback`
3.  Under the "Which API/SDKs are you planning to use?" section, check the box for **"Web API"**.
4.  Agree to the terms and conditions, then click **"Save"**.

### 3\. Get Your Credentials

After creating the app, you will be taken to its dashboard. Here you will find your **Client ID** and **Client Secret**. Click **"Show client secret"** to view it.

### 4\. Configure WAPresence

1.  In the WAPresence settings window, select **"Spotify"** as the media source.
2.  Copy the **Client ID**, **Client Secret**, and **Redirect URI** from your Spotify app page into the corresponding fields in WAPresence.
      * **Note:** The Redirect URI should match what you entered in the developer dashboard (`http://localhost:6969/callback`). Only change this if you know what you are doing.
3.  Click **"OK"**.

Your credentials will be automatically saved to the `config.ini` file, and WAPresence will be ready to connect to your Spotify account.