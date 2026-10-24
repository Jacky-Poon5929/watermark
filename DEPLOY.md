# Update your existing Netlify site

1. Sign in at https://app.netlify.com/ and open your existing project.
2. Open **Deploys** and scroll to the manual deploy dropzone at the bottom.
3. In Finder, open `/Users/jackypoon/Desktop/watermark`.
4. Drag the entire **deploy** folder into the dropzone. It includes your homepage, Watermark Studio, Image Converter, and Recipes. Uploading just the recipes folder would replace the whole site's contents with that folder.
5. Wait for the deployment to be published. Open your normal site address and click **Recipes**, or visit `/recipes/` on that domain.

No build command or dependency installation is needed. For future updates, edit the files inside `deploy`, then upload the whole folder again to the same project's Deploys page.

If you use Git-connected deployment instead, use `deploy` as the publish directory and leave the build command empty; push your changes to the connected production branch.

Official instructions: https://docs.netlify.com/deploy/create-deploys/

Image Converter is available at `/convert/`. Include all subfolders when uploading: it uses its own TIFF libraries and the HEIC decoder in `watermark/vendor`.

The converter now uses `engine.js`, `pool.js`, and `worker.js` for parallel processing. Upload these with the rest of the `deploy` folder.
