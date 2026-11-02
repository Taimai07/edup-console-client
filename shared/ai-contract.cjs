const AI_OPERATIONS=Object.freeze(['status','thread_list','thread_create','thread_read','thread_update','message_send','run_read','run_cancel','memory_list','memory_read','memory_save','memory_delete','file_list','file_read','file_save','file_delete','proposal_decide']);
function validateAIRequest(op,args){if(!AI_OPERATIONS.includes(op)||!args||typeof args!=='object'||Array.isArray(args)||JSON.stringify(args).length>90000)throw Error('AI_REQUEST_INVALID');return {op,args};}
module.exports={AI_OPERATIONS,validateAIRequest};
