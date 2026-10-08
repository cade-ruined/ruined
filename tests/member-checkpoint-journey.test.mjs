import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const loadedModule={exports:{}};
new Function('module','exports',ts.transpileModule(readFileSync(new URL('../src/lib/membership/operator-registration-progress.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(loadedModule,loadedModule.exports);
const {operatorMemberJourney:journey}=loadedModule.exports;
const at='2026-10-08T16:00:00.000Z';
const row=overrides=>({state:'collecting',registeredAt:null,profileComplete:true,ready:false,requiresInitialPayment:true,requiresPaymentMethod:false,completionBasis:null,emailVerified:true,paymentMethodState:'missing',paymentConfirmed:false,billingArranged:false,billingState:'pending',serviceStartsAt:null,paidCheckoutAvailable:true,...overrides});
const step=(result,key)=>result.checkpoints.find(item=>item.key===key);

test('Aaron and saved-card registrants share checkout as next action without pretending either paid',()=>{
 const incomplete=journey(row({requiresInitialPayment:false,requiresPaymentMethod:true}));
 const saved=journey(row({requiresInitialPayment:false,requiresPaymentMethod:true,paymentMethodState:'saved',registeredAt:at,ready:true,completionBasis:'saved_card'}));
 for(const result of [incomplete,saved]){assert.equal(result.next.key,'payment');assert.match(result.next.detail,/\/my\/activate/);assert.equal(step(result,'payment').state,'needed');assert.equal(step(result,'profile').state,'needed');}
 assert.equal(step(incomplete,'payment_method').state,'needed');assert.equal(step(saved,'payment_method').state,'complete');
});
test('verified ordinary checkout completes collection and payment without a standalone setup account',()=>{
 const result=journey(row({paymentConfirmed:true,paymentReceivedAt:at,registeredAt:at,ready:true,completionBasis:'paid_membership'}));
 assert.equal(step(result,'payment_method').state,'complete');assert.equal(step(result,'payment_method').completedAt,at);
 assert.match(step(result,'payment_method').detail,/Stripe checkout/);assert.equal(step(result,'payment').state,'complete');assert.equal(result.next.key,'profile');
});
test('current complimentary authority exempts both payment checkpoints and revoked authority does not',()=>{
 const comp=journey(row({paymentExempt:true,registeredAt:at,ready:true}));
 assert.equal(step(comp,'payment_method').state,'not_required');assert.equal(step(comp,'payment').state,'not_required');assert.equal(resultDateCount(comp),0);assert.equal(comp.next.key,'profile');
 const revoked=journey(row({completionBasis:'complimentary',paymentExempt:false}));assert.equal(revoked.next.key,'payment');assert.equal(step(revoked,'payment').state,'needed');
});
function resultDateCount(result){return result.checkpoints.filter(x=>x.completedAt).length;}
test('a shared partner has no separate collection requirement and awaits their payer until proof is received',()=>{
 const unpaid=journey(row({paymentByPartner:true}));assert.equal(step(unpaid,'payment_method').state,'not_required');assert.match(unpaid.next.detail,/Do not request a separate payment/);assert.equal(step(unpaid,'payment').state,'needed');
 const paid=journey(row({paymentByPartner:true,paymentConfirmed:true,paymentReceivedAt:at,registeredAt:at,ready:true}));assert.equal(step(paid,'payment').state,'complete');assert.equal(paid.next.key,'profile');
});
test('information and email are independently evidenced; missing earlier steps do not conceal an actual later payment',()=>{
 const result=journey(row({emailVerified:false,profileComplete:false,paymentConfirmed:true,paymentReceivedAt:at}));
 assert.equal(result.next.key,'email');assert.equal(step(result,'email').state,'needed');assert.equal(step(result,'payment').state,'complete');
 assert.equal(journey(row({profileComplete:false})).next.key,'information');
});
test('checkpoint dates are evidence dates only, never copied from registration creation or profile access',()=>{
 const unknown=journey(row({state:'activated',profileGranted:true,registeredAt:at,paymentConfirmed:true}));assert.equal(resultDateCount(unknown),0);
 assert.equal(step(unknown,'profile').state,'complete');assert.match(step(unknown,'profile').detail,/date not recorded/);
 const dated=journey(row({emailVerifiedAt:at,informationCollectedAt:at,paymentInformationCollectedAt:at,paymentReceivedAt:at,profileGrantedAt:at,profileGranted:true,paymentConfirmed:true}));assert.equal(resultDateCount(dated),5);assert.equal(dated.next.key,'complete');
});
test('refund, uncertain invoice and billing arrangements require review rather than requesting another payment',()=>{
 for(const override of [{paymentNeedsReview:true},{completionBasis:'paid_membership'},{historicalPaymentRecorded:true},{billingArranged:true},{billingState:'active'},{billingState:'attention_required'}]){
  const result=journey(row(override));assert.equal(result.next.key,'review');assert.equal(step(result,'payment').state,'review');assert.ok(result.attention);
 }
});
test('removed card or ended membership raises attention without erasing independently verified profile access',()=>{
 for(const override of [{paymentMethodState:'removed',paymentConfirmed:true},{billingState:'ended'}]){
  const result=journey(row({profileGranted:true,...override}));assert.equal(result.next.key,'review');assert.equal(step(result,'profile').state,'complete');assert.ok(result.attention);
 }
});
test('payment proof alone does not skip registration reconciliation or open a profile',()=>{
 const result=journey(row({paymentConfirmed:true}));assert.equal(result.next.key,'review');assert.match(result.next.label,/registration completion/);assert.equal(step(result,'profile').state,'needed');
});
test('closed paid checkout remains an explicit hold and an existing session is resumed instead of duplicated',()=>{
 assert.match(journey(row({paidCheckoutAvailable:false})).next.detail,/not open/);
 assert.match(journey(row({checkoutStarted:true})).next.detail,/resumes their existing checkout/);
});
