import XLSX from 'xlsx';

/**
 * Generate a base64 Excel string from Firestore collections.
 */
export const generateExcelBase64 = (categories, products, transactions, transactionItems) => {
  // 1. Create a new workbook
  const wb = XLSX.utils.book_new();

  // 2. Prepare Stock/Products Sheet
  const productsData = (products || []).map(p => ({
    'ID Produk': p.id || '',
    'Nama Produk': p.name || p.nama_produk || '',
    'Harga Jual': p.price || p.harga_jual || 0,
    'Stok Awal': p.starting_stock || p.stok_awal || 0,
    'Stok Saat Ini': p.current_stock || p.stok_sekarang || 0,
    'Kategori': p.category || p.kategori || ''
  }));
  const wsProducts = XLSX.utils.json_to_sheet(productsData);
  XLSX.utils.book_append_sheet(wb, wsProducts, 'Stok Barang');

  // 3. Prepare Transactions Sheet
  const transactionsData = (transactions || []).map(t => ({
    'ID Transaksi': t.id || '',
    'Tanggal': t.date || t.tanggal || '',
    'Total Belanja': t.total_amount || t.total || 0,
    'Metode Pembayaran': t.payment_method || t.pembayaran || '',
    'Kasir': t.cashier_name || t.kasir || ''
  }));
  const wsTransactions = XLSX.utils.json_to_sheet(transactionsData);
  XLSX.utils.book_append_sheet(wb, wsTransactions, 'Transaksi');

  // 4. Prepare Transaction Items Sheet
  const itemsData = (transactionItems || []).map(i => ({
    'ID Item': i.id || '',
    'ID Transaksi': i.transaction_id || '',
    'Nama Produk': i.product_name || i.nama_produk || '',
    'Jumlah': i.jumlah || 0,
    'Harga Satuan': i.price || i.harga || 0,
    'Subtotal': i.subtotal || 0
  }));
  const wsItems = XLSX.utils.json_to_sheet(itemsData);
  XLSX.utils.book_append_sheet(wb, wsItems, 'Item Transaksi');

  // 5. Prepare Categories Sheet
  const categoriesData = (categories || []).map(c => ({
    'ID Kategori': c.id || '',
    'Nama Kategori': c.name || c.nama_kategori || ''
  }));
  const wsCategories = XLSX.utils.json_to_sheet(categoriesData);
  XLSX.utils.book_append_sheet(wb, wsCategories, 'Kategori');

  // 6. Write workbook as base64 xlsx
  const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  return wbout;
};
