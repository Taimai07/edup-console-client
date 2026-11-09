// K1 operations owned by D2 and relayed through C4 to A2/A5.1.
module.exports = Object.freeze([
  {op: 'sku_list_save', readonly: false, idempotent: true,
    args: {id: 'uuid', site: 'site', source: 'paste|file|store', codes: 'sku[1..5000]', store: 'store?', label: 'text?'},
    errors: ['SKU_LIST_ID_INVALID', 'SKU_LIST_SOURCE_INVALID', 'SKU_LIST_SIZE_INVALID', 'SKU_LIST_CODES_INVALID',
      'SKU_LIST_STORE_INVALID', 'SKU_LIST_CONFLICT', 'LISTING_SITE_NOT_READY']},
  {op: 'sku_list_status', readonly: true, args: {id: 'uuid'},
    errors: ['SKU_LIST_ID_INVALID', 'SKU_LIST_NOT_FOUND']},
  {op: 'sku_list_index', readonly: true, args: {limit: 'integer[1..100]?'},
    errors: ['SKU_LIST_LIMIT_INVALID']},
]);
