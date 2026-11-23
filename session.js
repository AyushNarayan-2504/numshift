/* Each page load gets an independent, cryptographically random anonymous workspace. */
(() => {
  const bytes=new Uint8Array(16);
  if(!globalThis.crypto?.getRandomValues){window.NumShiftSession=null;return}
  crypto.getRandomValues(bytes);
  window.NumShiftSession=Object.freeze({id:Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')});
})();
