onmessage=async({data})=>{try{const bitmap=await createImageBitmap(data);postMessage({width:bitmap.width,height:bitmap.height});bitmap.close()}catch(e){postMessage({error:e.message})}};
