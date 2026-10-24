\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path=bakery_mrp,pg_temp;
SET LOCAL client_min_messages=notice;
CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION pg_temp.expect_failure(command text,fragment text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    IF position(fragment IN SQLERRM)=0 THEN RAISE EXCEPTION 'FAIL: %; unexpected error: %',label,SQLERRM; END IF;
    RAISE NOTICE 'PASS: %',label; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: %; expected an error',label;
END $$;

SELECT pg_temp.assert_true((SELECT count(*)=25 FROM information_schema.tables WHERE table_schema='bakery_mrp' AND table_type='BASE TABLE'),'Official schema has 25 tables');
SELECT pg_temp.assert_true((SELECT count(*)=18 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='bakery_mrp' AND NOT t.tgisinternal),'Only 18 original triggers');
SELECT pg_temp.assert_true((SELECT count(*)=11 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='bakery_mrp'),'Only 11 original functions');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='bakery_mrp' AND table_name IN ('schema_migration','schema_migrations','production_bom_snapshot','production_material_requirements')),'No snapshot or migration tables');
SELECT pg_temp.assert_true((SELECT receipt_date=DATE '2026-10-10' FROM material_receipt_notes WHERE material_receipt_note_id='RN01'),'Source receipt date preserved');
SELECT pg_temp.assert_true((SELECT bom_id='BOM01' FROM production_order_details WHERE production_order_detail_id='POD01'),'Historical order pins its BOM');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM users WHERE password_hash IS NULL),'Original empty password hashes preserved');
SELECT pg_temp.assert_true(has_permission('U02','bom','create') AND NOT has_permission('U03','bom','create'),'Seed BOM permissions match roles');

INSERT INTO users(user_id,username,full_name,email,role_id) VALUES('OTMGR','otmgr','Official test manager','otmgr@example.invalid','R02'),('OTEMP','otemp','Official test employee','otemp@example.invalid','R03');
INSERT INTO units(unit_id,unit_name,symbol) VALUES('OTKG','Official test kg','otkg'),('OTPC','Official test piece','otpc');
INSERT INTO suppliers(supplier_id,supplier_name) VALUES('OTSUP','Official test supplier');
INSERT INTO materials(material_id,material_name,min_stock,unit_id) VALUES('OTFL','Official test flour',10,'OTKG'),('OTBU','Official test butter',2,'OTKG');
INSERT INTO products(product_id,product_name,unit_id) VALUES('OTCAKE','Official test cake','OTPC'),('OTBUN','Official test bun','OTPC'),('OTOTHER','Official FK test product','OTPC');
INSERT INTO bom(bom_id,product_id,version_code,unit_id,created_by) VALUES('OTBC1','OTCAKE','1.0','OTPC','OTMGR'),('OTBB1','OTBUN','1.0','OTPC','OTMGR');
INSERT INTO bom_details(bom_detail_id,bom_id,material_id,quantity) VALUES('OTBDC1','OTBC1','OTFL',0.8),('OTBDC2','OTBC1','OTBU',0.2),('OTBDB1','OTBB1','OTFL',0.2);
INSERT INTO production_orders(production_order_id,created_by,assigned_to,due_date) VALUES('OTPO','OTMGR','OTEMP',CURRENT_DATE);
INSERT INTO production_order_details(production_order_detail_id,production_order_id,product_id,bom_id,target_quantity) VALUES('OTPOD1','OTPO','OTCAKE','OTBC1',10),('OTPOD2','OTPO','OTBUN','OTBB1',10);
SELECT pg_temp.expect_failure($q$INSERT INTO production_order_details(production_order_detail_id,production_order_id,product_id,bom_id,target_quantity) VALUES('OTBAD','OTPO','OTOTHER','OTBC1',1)$q$,'production_order_details_bom_product_fkey','Order cannot use a BOM of another product');
SELECT pg_temp.expect_failure($q$UPDATE bom_details SET quantity=0.9 WHERE bom_detail_id='OTBDC1'$q$,'BOM đã được sử dụng','Referenced BOM lines are immutable');
SELECT pg_temp.expect_failure($q$DELETE FROM bom WHERE bom_id='OTBC1'$q$,'BOM đã được sử dụng','Referenced BOM cannot be deleted');
SELECT pg_temp.expect_failure($q$UPDATE bom SET version_code='renamed' WHERE bom_id='OTBC1'$q$,'BOM đã được sử dụng','Referenced BOM version cannot be renamed');
UPDATE bom SET is_active=false WHERE bom_id='OTBC1';
INSERT INTO bom(bom_id,product_id,version_code,unit_id,created_by) VALUES('OTBC2','OTCAKE','2.0','OTPC','OTMGR');
INSERT INTO bom_details(bom_detail_id,bom_id,material_id,quantity) VALUES('OTB2D1','OTBC2','OTFL',1.2),('OTB2D2','OTBC2','OTBU',0.3);
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM bom WHERE product_id='OTCAKE'),'Product retains multiple BOM versions');
SELECT pg_temp.expect_failure($q$INSERT INTO bom(bom_id,product_id,version_code,unit_id,created_by) VALUES('OTBCACT','OTCAKE','3.0','OTPC','OTMGR')$q$,'idx_active_bom','Only one active BOM per product');
SELECT pg_temp.expect_failure($q$INSERT INTO bom(bom_id,product_id,version_code,is_active,unit_id,created_by) VALUES('OTBCDUP','OTCAKE','1.0',false,'OTPC','OTMGR')$q$,'bom_product_version_key','Version is unique per product');
SELECT pg_temp.assert_true((SELECT sum(d.target_quantity*b.quantity)=10 FROM production_order_details d JOIN bom_details b ON b.bom_id=d.bom_id WHERE d.production_order_id='OTPO' AND b.material_id='OTFL'),'Old order requirements stay on version 1 after version 2 activation');
INSERT INTO production_orders(production_order_id,created_by,assigned_to,due_date) VALUES('OTNEW','OTMGR','OTEMP',CURRENT_DATE);
INSERT INTO production_order_details(production_order_detail_id,production_order_id,product_id,bom_id,target_quantity) VALUES('OTNEWD','OTNEW','OTCAKE','OTBC2',10);
SELECT pg_temp.assert_true((SELECT sum(d.target_quantity*b.quantity)=12 FROM production_order_details d JOIN bom_details b ON b.bom_id=d.bom_id WHERE d.production_order_id='OTNEW' AND b.material_id='OTFL'),'New order uses version 2 requirements');
SELECT pg_temp.expect_failure($q$UPDATE production_orders SET status='in_progress' WHERE production_order_id='OTPO'$q$,'Chưa xuất đủ','Stock approval is required before production');

INSERT INTO material_replenishment_requests(material_replenishment_request_id,created_by,request_type,production_id) VALUES('OTMR','OTEMP','production','OTPO');
INSERT INTO material_replenishment_request_details(replenishment_request_detail_id,material_replenishment_request_id,material_id,requirement_quantity,requested_quantity) VALUES('OTMRD1','OTMR','OTFL',10,10),('OTMRD2','OTMR','OTBU',2,2);
SELECT pg_temp.expect_failure($q$UPDATE material_replenishment_requests SET status='approved',approved_by='OTEMP' WHERE material_replenishment_request_id='OTMR'$q$,'không có quyền','Employee ID cannot approve documents');
SELECT pg_temp.expect_failure($q$UPDATE material_replenishment_requests SET status='rejected',approved_by='OTMGR' WHERE material_replenishment_request_id='OTMR'$q$,'lý do','Reject requires a reason');
UPDATE material_replenishment_requests SET status='approved',approved_by='OTMGR' WHERE material_replenishment_request_id='OTMR';
SELECT pg_temp.assert_true((SELECT reviewed_at IS NOT NULL FROM material_replenishment_requests WHERE material_replenishment_request_id='OTMR'),'Review timestamp set by existing trigger');
SELECT pg_temp.expect_failure($q$UPDATE material_replenishment_request_details SET requested_quantity=11 WHERE replenishment_request_detail_id='OTMRD1'$q$,'trạng thái approved','Approved request details locked');
INSERT INTO material_receipt_notes(material_receipt_note_id,created_by,supplier_id,material_replenishment_request_id,receipt_date) VALUES('OTRN','OTMGR','OTSUP','OTMR',CURRENT_DATE-1);
SELECT pg_temp.expect_failure($q$INSERT INTO material_receipt_notes(material_receipt_note_id,created_by,supplier_id,material_replenishment_request_id,receipt_date) VALUES('OTRN2','OTMGR','OTSUP','OTMR',CURRENT_DATE)$q$,'material_receipt_notes_material_replenishment_request_id_key','Only one receipt per replenishment');
INSERT INTO material_receipt_note_details(material_receipt_note_detail_id,material_receipt_note_id,material_id,received_quantity) VALUES('OTRND1','OTRN','OTFL',12),('OTRND2','OTRN','OTBU',3);
SELECT pg_temp.expect_failure($q$UPDATE material_receipt_notes SET status='completed' WHERE material_receipt_note_id='OTRN'$q$,'Chuyển trạng thái','Receipt cannot skip pending');
UPDATE material_receipt_notes SET status='pending' WHERE material_receipt_note_id='OTRN';
SELECT pg_temp.expect_failure($q$UPDATE material_receipt_notes SET note='forbidden' WHERE material_receipt_note_id='OTRN'$q$,'nhà cung cấp','Pending receipt note locked by original guard');
SELECT pg_temp.expect_failure($q$UPDATE material_receipt_note_details SET received_quantity=13 WHERE material_receipt_note_detail_id='OTRND1'$q$,'trạng thái pending','Pending receipt lines locked');
UPDATE material_receipt_notes SET status='completed' WHERE material_receipt_note_id='OTRN';
SELECT pg_temp.assert_true((SELECT stock_quantity=12 FROM materials WHERE material_id='OTFL'),'Receipt quantity may differ from requested');
SELECT pg_temp.assert_true((SELECT status='fulfilled' FROM material_replenishment_requests WHERE material_replenishment_request_id='OTMR'),'Receipt automatically fulfills replenishment');
SELECT pg_temp.assert_true((SELECT business_date=CURRENT_DATE-1 FROM material_transactions WHERE record_id='OTRN' AND material_id='OTFL'),'Receipt ledger uses business date');
UPDATE material_receipt_notes SET status='completed' WHERE material_receipt_note_id='OTRN';
SELECT pg_temp.assert_true((SELECT stock_quantity=12 FROM materials WHERE material_id='OTFL'),'Repeated receipt complete does not double stock');

INSERT INTO material_issue_requests(material_issue_request_id,created_by,production_id) VALUES('OTMI','OTEMP','OTPO'),('OTMIB','OTEMP','OTPO');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM material_issue_requests WHERE production_id='OTPO'),'Issue count is deliberately delegated to Backend');
DELETE FROM material_issue_requests WHERE material_issue_request_id='OTMIB';
INSERT INTO material_issue_request_details(material_issue_request_detail_id,material_issue_request_id,material_id,material_requirement,request_quantity) VALUES('OTMID1','OTMI','OTFL',10,10),('OTMID2','OTMI','OTBU',2,2);
UPDATE material_issue_requests SET status='approved',approved_by='OTMGR' WHERE material_issue_request_id='OTMI';
SELECT pg_temp.assert_true((SELECT stock_quantity=2 FROM materials WHERE material_id='OTFL'),'Approved issue deducts NVL');
UPDATE material_issue_requests SET status='approved',approved_by='OTMGR' WHERE material_issue_request_id='OTMI';
SELECT pg_temp.assert_true((SELECT stock_quantity=2 FROM materials WHERE material_id='OTFL'),'Repeated issue approval does not deduct twice');
SELECT pg_temp.expect_failure($q$UPDATE production_orders SET status='cancelled' WHERE production_order_id='OTPO'$q$,'Đã xuất NVL','Cannot cancel after material issue');
UPDATE production_orders SET status='in_progress' WHERE production_order_id='OTPO';
SELECT pg_temp.assert_true((SELECT status='in_progress' FROM production_orders WHERE production_order_id='OTPO'),'Start uses inactive version 1 pinned to order');
SELECT pg_temp.expect_failure($q$UPDATE production_order_details SET bom_id='OTBC2' WHERE production_order_detail_id='OTPOD1'$q$,'completed_quantity','Cannot switch BOM during production');
SELECT pg_temp.expect_failure($q$UPDATE production_order_details SET completed_quantity=11 WHERE production_order_detail_id='OTPOD1'$q$,'production_order_details_check','Progress cannot exceed target');
UPDATE production_order_details SET completed_quantity=8 WHERE production_order_detail_id='OTPOD1';
UPDATE production_order_details SET completed_quantity=9 WHERE production_order_detail_id='OTPOD2';
UPDATE production_orders SET status='completed' WHERE production_order_id='OTPO';
SELECT pg_temp.assert_true((SELECT stock_quantity=8 FROM products WHERE product_id='OTCAKE'),'Completion stocks actual cake quantity');
SELECT pg_temp.assert_true((SELECT stock_quantity=9 FROM products WHERE product_id='OTBUN'),'Completion stocks actual bun quantity');
SELECT pg_temp.assert_true((SELECT completion_date IS NOT NULL FROM production_orders WHERE production_order_id='OTPO'),'Completion timestamp recorded');
UPDATE production_orders SET status='completed' WHERE production_order_id='OTPO';
SELECT pg_temp.assert_true((SELECT stock_quantity=8 FROM products WHERE product_id='OTCAKE'),'Repeated production completion does not double stock');
SELECT pg_temp.expect_failure($q$UPDATE bom_details SET quantity=2 WHERE bom_detail_id='OTBDC1'$q$,'BOM đã được sử dụng','Old BOM remains immutable after completed order');
SELECT pg_temp.expect_failure($q$UPDATE production_orders SET note='forbidden' WHERE production_order_id='OTPO'$q$,'đã xử lý','Completed order cannot be edited');

INSERT INTO product_issue_requests(product_issue_request_id,created_by) VALUES('OTPI','OTEMP');
INSERT INTO product_issue_request_details(product_issue_request_detail_id,product_issue_request_id,product_id,request_quantity) VALUES('OTPID1','OTPI','OTCAKE',3);
UPDATE product_issue_requests SET status='approved',approved_by='OTMGR' WHERE product_issue_request_id='OTPI';
SELECT pg_temp.assert_true((SELECT stock_quantity=5 FROM products WHERE product_id='OTCAKE'),'Product issue posts stock');
SELECT pg_temp.expect_failure($q$DELETE FROM material_transactions WHERE record_id='OTRN'$q$,'Không sửa/xóa','Material ledger immutable');
SELECT pg_temp.expect_failure($q$UPDATE product_transactions SET record_id='other' WHERE record_id='OTPI'$q$,'Không sửa/xóa','Product ledger immutable');
SELECT pg_temp.expect_failure($q$UPDATE materials SET stock_quantity=-1 WHERE material_id='OTFL'$q$,'materials_stock_quantity_check','Negative material stock blocked');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM business_events),'No extra timeline triggers');
INSERT INTO business_events(object_type,object_id,action,actor_user_id,from_status,to_status) VALUES('production_orders','OTPO','complete','OTEMP','in_progress','completed');
INSERT INTO notifications(notification_id,user_id,message,record_id,object_type) VALUES('OTN1','OTMGR','Backend creates notification','OTPO','production_orders');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM business_events WHERE object_id='OTPO' AND actor_user_id='OTEMP'),'Backend can persist timeline');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM notifications WHERE notification_id='OTN1'),'Backend can persist notifications');

INSERT INTO production_orders(production_order_id,created_by,assigned_to,due_date) VALUES('OTATOM','OTMGR','OTEMP',CURRENT_DATE),('OTCON','OTMGR','OTEMP',CURRENT_DATE);
INSERT INTO production_order_details(production_order_detail_id,production_order_id,product_id,bom_id,target_quantity) VALUES('OTATD','OTATOM','OTCAKE','OTBC2',1),('OTCOND','OTCON','OTBUN','OTBB1',10);
INSERT INTO material_issue_requests(material_issue_request_id,created_by,production_id) VALUES('OTATMI','OTEMP','OTATOM'),('OTCONMI','OTEMP','OTCON');
INSERT INTO material_issue_request_details(material_issue_request_detail_id,material_issue_request_id,material_id,material_requirement,request_quantity) VALUES('OTATBU','OTATMI','OTBU',0.3,0.3),('OTATFL','OTATMI','OTFL',1.2,1.2),('OTCONFL','OTCONMI','OTFL',2,2);
UPDATE material_issue_requests SET status='approved',approved_by='OTMGR' WHERE material_issue_request_id='OTCONMI';
SELECT pg_temp.expect_failure($q$UPDATE material_issue_requests SET status='approved',approved_by='OTMGR' WHERE material_issue_request_id='OTATMI'$q$,'không đủ','Multi-line issue failure rolls back atomically');
SELECT pg_temp.assert_true((SELECT stock_quantity=1 FROM materials WHERE material_id='OTBU'),'Earlier stock line rolled back');
SELECT pg_temp.assert_true((SELECT status='pending' FROM material_issue_requests WHERE material_issue_request_id='OTATMI'),'Failed approval status rolled back');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM material_transactions WHERE record_id='OTATMI'),'Failed approval ledger rolled back');
ROLLBACK;
