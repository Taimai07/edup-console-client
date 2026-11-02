// Pure contract for future desktop integration. This module never launches a browser.
const hosts={US:'sellercentral.amazon.com',DE:'sellercentral.amazon.de',FR:'sellercentral.amazon.fr',GB:'sellercentral.amazon.co.uk',NL:'sellercentral.amazon.nl',IT:'sellercentral.amazon.it',ES:'sellercentral.amazon.es',BE:'sellercentral.amazon.com.be',PL:'sellercentral.amazon.pl',SE:'sellercentral.amazon.se',IE:'sellercentral.amazon.ie',CA:'sellercentral.amazon.ca',MX:'sellercentral.amazon.com.mx',BR:'sellercentral.amazon.com.br',SA:'sellercentral.amazon.sa'};
function buildZiniaoRoute({account,site,sku,binding}){
 if(account!=='EDUPLINK / A'||!Object.hasOwn(hosts,site)||!binding||binding.account!==account||binding.site!==site)throw Error('STORE_BINDING_MISMATCH');
 if(!binding.verified)throw Error('STORE_BINDING_NOT_VERIFIED');
 if(!/^[A-Za-z0-9_-]{1,80}$/.test(binding.storeId||'')||!/^[A-Za-z0-9_-]{1,80}$/.test(binding.userId||''))throw Error('BINDING_ID_INVALID');
 if(typeof sku!=='string'||!sku.trim()||sku.length>100||/[\x00-\x1f]/.test(sku))throw Error('SKU_INVALID');
 const v=String(binding.version||'').match(/^(\d+)\.(\d+)/);if(!v||!(Number(v[1])===5&&Number(v[2])>=290||Number(v[1])===6&&Number(v[2])>=25))throw Error('ZINIAO_VERSION_NEEDS_VERIFICATION');
 if(binding.loggedInUserId!==binding.userId)throw Error('ZINIAO_LOGIN_MISMATCH');
 const target=new URL('https://'+hosts[site]+'/myinventory/inventory');target.searchParams.set('searchField','all');target.searchParams.set('searchTerm',sku);
 const params=new URLSearchParams({storeId:binding.storeId,userId:binding.userId,lanuchUrl:Buffer.from(target.href,'utf8').toString('base64'),autoopen:'true'});
 return {target:target.href,protocolUrl:'superbrowser://OpenStrore?'+params,launchAction:'user_click_only',fallbackToDefaultBrowser:false};
}
module.exports={buildZiniaoRoute};
