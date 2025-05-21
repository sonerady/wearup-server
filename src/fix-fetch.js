// Node.js 18+ için fetch API düzeltmesi
// Bu dosya, app.js dosyasından önce yüklenmeli (require) veya import edilmeli

/**
 * Node.js 18+ sürümlerinde, stream göndermek için fetch API kullanıldığında
 * 'duplex' seçeneği gerektiriyor. Bu düzeltme, otomatik olarak duplex: 'half' ekliyor.
 */
if (global.fetch) {
  const originalFetch = global.fetch;
  global.fetch = function patchedFetch(url, options = {}) {
    // options.body varsa ve duplex belirtilmemişse duplex: 'half' ekle
    if (options.body && !options.duplex) {
      options.duplex = "half";
    }
    return originalFetch(url, options);
  };
  console.log("✅ Global fetch fonksiyonu düzeltildi (Node.js 18+ ile uyumlu)");
}

module.exports = {};
