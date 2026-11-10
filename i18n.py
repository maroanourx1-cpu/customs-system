"""تبديل لغة الموقع بالكامل: عربي فقط / English only.

الفكرة: كل صفحة بتتولّد زي ما هي (بالعربي)، وبعدها بنترجم الـ HTML قبل ما يتبعت للمتصفح حسب
اللغة المحفوظة في الكوكي `lang`.  لتعديل أو إضافة ترجمة: زوّد سطر في EN (عربي => إنجليزي)
أو AR (إنجليزي => عربي) تحت.  البيانات اللي المستخدمين بيكتبوها (أسماء عملاء، رسائل شات..) مابتتترجمش.
"""
import html as _h
import re
from functools import lru_cache
from urllib.parse import urlparse

from flask import redirect, request, url_for

COOKIE = "lang"
AR_RE = re.compile(r"[\u0600-\u06FF]")
LAT_RE = re.compile(r"[A-Za-z]")
SHORT_OK = {"،", "شحنة", "يوجد"}
AR_LETTERS = "\u0621-\u0652\u066E-\u06D3"  # حروف بس (من غير علامات الترقيم العربي زي ، ؟)


def _parse(block):
    d = {}
    for line in block.strip().splitlines():
        if " => " in line:
            k, v = line.split(" => ", 1)
            d[re.sub(r"\s+", " ", k.strip())] = v.strip()
    return d


# ======================================================== عربي => English
EN = _parse(r'''
(اتركه فارغاً للترقيم التلقائي) => (leave empty for auto-numbering)
(اعتمده => (approved by
(شحنة => (shipment
(يقرأ الصور المطبوعة الواضحة فقط، ومش بيقرا PDF) => (reads clear printed images only, not PDF)
) أو برنامج Tesseract مثبّت على الجهاز. التفاصيل في الإعدادات. => ) or Tesseract installed on this machine. Details are in Settings.
Gemini (الأدق، ومجاني): => Gemini (most accurate, free):
INX – تسجيل الدخول => INX – Sign in
Tesseract (بدون إنترنت): => Tesseract (offline):
VAT / الرقم الضريبي => VAT No.
VAT المورد => Supplier VAT No.
· التقديم: => · Submitted:
· المتابعة: => · Follow-up:
· المسؤول: => · Responsible:
· المورد: => · Supplier:
· رقم الطلب: => · Request No.:
· صدور الموافقة: => · Approval date:
، => ,
آخر الشحنات => Latest shipments
آخر النسخ => Latest backups
آخر تعديل => Last modified
أضافه: => Added by:
أمر # => Order #
أمر تكليف # => Assignment order #
أمر تكليف جديد => New assignment order
أمر جديد => New order
أمر جديد لم تفتحه بعد => New order you have not opened yet
أمر جديد من => New order from
أمر: => Order:
أنواع العروض الرقابية => Regulatory approval types
أهلاً => Hello
أوامر جديدة لم تفتحها بعد => new orders you have not opened yet
أوامر مفتوحة عليك => Open orders for you
أوامر ومهام الموظفين => Employee orders & tasks
أول ما كل المطلوب يتوفر (بيانات أو مستندات) المرحلة بتتحدث لوحدها. => As soon as everything required is available (data or documents), the stage updates automatically.
أُرسل => Sent
أُضيفت بواسطة => Added by
إجمالي الشحنات => Total shipments
إدارة أسهل .. متابعة أدق => Easier management .. more accurate tracking
إدارة أنواع العروض => Manage approval types
إدارة أنواع العروض الرقابية => Manage regulatory approval types
إرسال => Send
إرسال أمر => Send order
إرسال أمر جديد => Send a new order
إرسال الأمر => Send order
إرفاق ملف => Attach file
إزاي بتتم: => How it is done:
إضافة => Add
إضافة (شحنات ومستندات) => Add (shipments & documents)
إضافة أو إيقاف أنواع العروض الرقابية المتاحة للشحنات. => Add or disable the regulatory approval types available for shipments.
إضافة العرض => Add offer
إضافة عرض جديد => Add a new offer
إضافة للشحنة => Add to shipment
إضافة للقائمة => Add to list
إضافة نوع جديد => Add new type
إظهار العدادات الحمراء في القائمة (رسائل / أوامر) => Show red counters in the menu (messages / orders)
إظهار كلمة المرور => Show password
إعدادات الإشعارات والعدادات (خاصة بحسابي) => Notification & counter settings (my account only)
إلغاء => Cancel
إلغاء الاعتماد => Revoke approval
إلغاء من القائمة => Remove from list
إلغاء هذا المستند من قائمة السحب؟ => Remove this document from the pull list?
إلى => To
إلى الموظف * => To employee *
إنشاء وتحميل نسخة احتياطية الآن => Create & download a backup now
إيقاف => Disable
ابدأ محادثة => Start a conversation
احتساب رسائل الشات العام في عداد الرسائل => Count general chat messages in the message counter
اختر صورة المستند (أو صوّره من الموبايل) أو ملف PDF، وبمجرد الاختيار هيتقرأ وتتعمل شحنة جديدة بكل البيانات الموجودة فيه، والصورة بتتحفظ مع مستنداتها. => Choose a document image (or photograph it with your phone) or a PDF file. As soon as you choose, it is read and a new shipment is created with all the data found in it, and the image is saved with its documents.
اختر موظفًا من القائمة لبدء المحادثة => Choose an employee from the list to start a conversation
اختر... => Choose...
اختيار العروض الرقابية المطلوبة (يمكن اختيار أكثر من عرض): => Select the required regulatory approvals (you can pick more than one):
استعادة => Restore
استعادة نسخة => Restore a backup
اسحب الملفات هنا أو اضغط للاختيار => Drag files here or click to choose
اسكان => Scan
اسكان مستند => Scan a document
اسم الشركة => Company name
اسم الشركة * => Company name *
اسم المستخدم => Username
اضغط على أي مرحلة لشرحها => Click any stage for an explanation
اضغط لاختيار صورة المستند => Click to choose a document image
اعتماد => Approve
اعتماد العروض => Approve offers
اعتماد العروض (الاختيارات) => Approve offers (selections)
اعتماد هذا العرض؟ => Approve this offer?
اعتمده: => Approved by:
اكتب رسالة... => Type a message...
اكتب ملاحظة... => Write a note...
الأحدث إضافة => Newest first
الأقل => Lowest
الأقل سعرًا => Lowest price
الأمر => Order
الأنواع الحالية => Current types
الأنواع الموقوفة لا تظهر عند اختيار العروض الجديدة، لكن العروض المسجلة بها على الشحنات تبقى كما هي. => Disabled types do not appear when choosing new approvals, but approvals already recorded with them on shipments stay as they are.
الأوامر => Orders
الأوامر المرتبطة بالشحنة => Orders linked to the shipment
الأوامر والمهام => Orders & tasks
الإجمالي => Total
الإعدادات => Settings
الاختيارات — => Selections —
الاسكان (قراءة المستندات) => Scanning (document reading)
الاسكان محتاج مفتاح Gemini المجاني (من => Scanning needs the free Gemini key (from
الاسم => Name
الاسم الكامل => Full name
البحث والاستعلام => Search & inquiry
البند => Tariff code
التاريخ => Date
التعديلات => Edits
التفاصيل => Details
التقارير => Reports
التقديم => Submission
الجهة => Authority
الجهة المختصة => Competent authority
الجهة المقدمة للعرض * => Offer provider *
الجهة: => Authority:
الحالة => Status
الحالة (الأقل تقدمًا) => Status (least advanced)
الحالة (الأكثر تقدمًا) => Status (most advanced)
الحساب نشط (ألغِ التحديد لإيقافه) => Account active (untick to disable it)
الخدمة => Service
الخدمة: => Service:
الدور => Role
الرئيسية => Home
الرقم الضريبي => VAT No.
الرقم الضريبي للمورد => Supplier VAT No.
السعر => Price
السعر * => Price *
الشات الداخلي => Internal chat
الشات العام => General chat
الشحنات => Shipments
الشحنات ( => Shipments (
الشحنة => Shipment
الشرح عام، وممكن تختلف التفاصيل حسب المنفذ ونوع البضاعة. => The explanation is general; details may vary by port and type of goods.
الصادرة مني => Sent by me
الصلاحيات => Permissions
الطرود => Packages
العرض => Offer
العرض المعتمد: => Approved offer:
العروض => Offers
العروض ( => Offers (
العروض الرقابية => Regulatory approvals
العروض الرقابية (Regulatory Approvals) => Regulatory Approvals
العروض الرقابية المعلقة => Pending regulatory approvals
العروض بعملات مختلفة؛ المقارنة بالنسبة المئوية تتم داخل كل عملة على حدة. => Offers are in different currencies; the percentage comparison is done within each currency separately.
العملة => Currency
العملية => Operation
العميل => Customer
الفرق عن الأقل => Difference from lowest
القائم / الصافي => Gross / Net
القائمة => Menu
القراءة أخدت وقت أطول من اللازم، حاول مرة أخرى. => Reading took too long, please try again.
القراءة بتاخد حوالي 10–30 ثانية. الصور لحد 10 ميجا. المحرك الحالي: => Reading takes about 10–30 seconds. Images up to 10 MB. Current engine:
الكل => All
المتابعة => Follow-up
المرحلة => Stage
المرحلة الحالية => Current stage
المسؤول => Responsible
المسؤول عن المتابعة => Follow-up owner
المسؤول: => Responsible:
المستند => Document
المستندات => Documents
المستندات ( => Documents (
المستندات الناقصة (سحب المستندات) => Missing documents (document pulls)
المطلوب لانتقال الشحنة تلقائيًا للمرحلة التالية: => Required for the shipment to move automatically to the next stage:
المطلوب: => Required:
المفتوحة => Open
الملاحظات والتحديثات => Notes & updates
الملف => File
المنتهية => Completed
المنشأ => Origin
الموافقات / المستندات: => Approvals / documents:
المورد => Supplier
الموظف => Employee
الموظف المسؤول => Responsible employee
الموظفون => Employees
النتائج ( => Results (
النسخ الاحتياطي والاستعادة => Backup & restore
النوع => Type
الواردة لي => Received by me
الوضع الداكن => Dark mode
الوقت => Time
بحث => Search
بحث (شحنة / عميل / بوليصة) => Search (shipment / customer / B/L)
بحث (شحنة / عميل / رقم طلب / جهة / ACID) => Search (shipment / customer / request no. / authority / ACID)
بيانات الشحنات => Shipment data
بيانات الشحنة => Shipment data
بيانات الشحنة والجمارك => Shipment & customs data
تأكيد كلمة المرور الجديدة => Confirm new password
تاريخ التقديم => Submission date
تاريخ السحب => Pull date
تاريخ السحب: => Pull date:
تاريخ الوصول => Arrival date
تاريخ الوصول (الأحدث) => Arrival date (newest)
تاريخ الوصول (الأقدم) => Arrival date (oldest)
تاريخ الوصول من => Arrival date from
تاريخ صدور الموافقة => Approval issue date
تحديث الحالة => Update status
تحديث المرحلة => Update stage
تحديد المستندات المطلوبة: => Select the required documents:
تحميل => Download
ترتيب حسب => Sort by
تصدير Excel/CSV => Export Excel/CSV
تصدير أوامر الموظفين CSV => Export employee orders CSV
تعديل => Edit
تعديل الشحنة => Edit shipment
تعديل موظف => Edit employee
تعذر الإرسال => Could not send
تعذر الاتصال بالسيرفر => Could not reach the server
تعذر الاتصال بالسيرفر. => Could not reach the server.
تعليمات إضافية... => Additional instructions...
تغيير كلمة المرور => Change password
تفاصيل الشحنات والمستندات الناقصة => Shipments with missing documents – details
تفاصيل الشحنة: => Shipment details:
تفاصيل العرض => Offer details
تفعيل => Enable
تقارير سريعة => Quick reports
تم الاطلاع => Seen
تم السحب => Pulled
تم سحب كل المستندات المطلوبة => All required documents have been pulled
تم! جاري فتح الشحنة... => Done! Opening the shipment...
تمت الموافقة => Approved
تنبيه الأمر الجديد (الشريط الأحمر) بيفضل ظاهر لحد ما تفتح الأمر مهما كانت الإعدادات. => The new-order alert (red bar) stays visible until you open the order, whatever the settings.
تنبيه: لديك => Alert: you have
تُؤخذ نسخة تلقائية مرة كل 24 ساعة عند دخول أحد المستخدمين (تُحفظ آخر 14 نسخة في المجلد data/backups). => An automatic backup is taken once every 24 hours when a user signs in (the last 14 backups are kept in the data/backups folder).
جاري التنفيذ => In progress
جاري تجهيز المستند... => Preparing the document...
جاري رفع المستند... => Uploading the document...
جاري قراءة المستند واستخراج البيانات... => Reading the document and extracting data...
جديد => New
حالة الشحنات => Shipment status
حالة الشحنة => Shipment status
حذف => Delete
حذف الشحنة؟ => Delete the shipment?
حذف العرض؟ => Delete the offer?
حذف المستند؟ => Delete the document?
حذف هذا العرض الرقابي من الشحنة؟ => Delete this regulatory approval from the shipment?
حصل خطأ غير متوقع، حدّث الصفحة وحاول تاني. => An unexpected error occurred, refresh the page and try again.
حفظ => Save
حفظ المفتاح => Save key
خروج => Sign out
دخول => Sign in
ربط بشحنة (اختياري) => Link to a shipment (optional)
رجوع => Back
رجوع للشحنة => Back to shipment
رسائل غير مقروءة => Unread messages
رسائل لكل الموظفين => Messages to all employees
رفع المستند => Upload document
رفع موافقة / مستند => Upload approval / document
رفع نسخة => Upload a copy
رقابي => Regulatory
رقابي معلق => Regulatory pending
رقم ACID => ACID No.
رقم الأوردر => Order No.
رقم البوليصة => B/L No.
رقم الشحنة => Shipment No.
رقم الشحنة * => Shipment No. *
رقم الطلب => Request No.
رقم الطلب / المعاملة => Request / transaction No.
رُفع بواسطة => Uploaded by
سجل => Log
سجل التعديلات => Audit log
سجل الشحنة: => Shipment log:
سحب المستندات => Document pulls
سيتم استبدال كل البيانات الحالية. متأكد؟ => All current data will be replaced. Are you sure?
شحنات مفتوحة => Open shipments
شحنات منتهية => Completed shipments
شحنة => Shipment
شحنة جديدة => New shipment
شحنة جديدة وإدراج مستندات => New shipment & document entry
شركة الشحن => Shipping company
شركة شحن / مخلص / مورد ... => Shipping company / clearing agent / supplier ...
شروط، مدة الصلاحية، ما يشمله السعر... => Terms, validity, what the price includes...
صدور الموافقة => Approval issued
صوت تنبيه الأوامر الجديدة => New-order alert sound
طباعة => Print
عرض => Show
عرض التقرير => Show report
عرض بانتظار الاعتماد — => offer(s) awaiting approval —
عروض رقابية بدون موافقة => Regulatory approvals without approval
عروض رقابية بدون موافقة: => Regulatory approvals without approval:
عروض رقابية معلقة => Pending regulatory approvals
عملة الفاتورة => Invoice currency
عنوان الأمر * => Order title *
غير المكتملة => Incomplete
غير مثبّت. نزّله على جهاز السيرفر (على ويندوز: نسخة UB Mannheim، واختار لغة Arabic وقت التثبيت)، وبعدها أعد تشغيل البرنامج. => Not installed. Download it onto the server machine (on Windows: the UB Mannheim build, and choose the Arabic language during installation), then restart the program.
غير مضبوط. اعمل مفتاح مجاني من Google AI Studio (aistudio.google.com ← Get API key) والصقه هنا. => Not set. Create a free key from Google AI Studio (aistudio.google.com → Get API key) and paste it here.
فتح الأوامر => Open orders
فتح الاختيارات => Open selections
فعّال => Active
فيه عروض رقابية معلقة => Has pending regulatory approvals
فيه مستندات لم تُسحب => Has documents not yet pulled
قُرئ => Read
كتم الصوت => Mute sound
كل الأنواع => All types
كل الأوامر (مدير) => All orders (admin)
كل الحالات => All statuses
كل العروض الرقابية حاصلة على موافقة => All regulatory approvals are approved
كل المستندات الأساسية مرفوعة => All core documents are uploaded
كلمة المرور => Password
كلمة المرور الجديدة => New password
كلمة المرور الحالية => Current password
كلمة مرور جديدة (اختياري) => New password (optional)
كلها اتسحبت => All pulled
لا توجد أوامر => No orders
لا توجد أوامر على هذه الشحنة => No orders on this shipment
لا توجد بيانات => No data
لا توجد شحنات => No shipments
لا توجد عروض بعد. أضف أول عرض من النموذج أعلاه. => No offers yet. Add the first offer using the form above.
لا توجد عروض مطابقة => No matching offers
لا توجد مستندات => No documents
لا توجد مستندات بعد => No documents yet
لا توجد مستندات مرفوعة => No uploaded documents
لا توجد مستندات مطابقة => No matching documents
لا توجد ملاحظات => No notes
لا توجد نسخة إلكترونية مرفوعة => No electronic copy uploaded
لا يوجد سجل => No log entries
لا يوجد موظفون آخرون بعد. أضفهم من صفحة الموظفين. => No other employees yet. Add them from the Employees page.
لرفع مستند جديد افتح الشحنة المطلوبة من صفحة الشحنات. => To upload a new document, open the shipment from the Shipments page.
لم تصدر موافقتها بعد => Approval not issued yet
لم يتم السحب => Not pulled
لم يتم تحديد عروض رقابية على هذه الشحنة بعد. => No regulatory approvals have been specified for this shipment yet.
لم يتم تحديد مستندات مطلوبة للسحب على هذه الشحنة بعد. => No documents to pull have been specified for this shipment yet.
لم يُسحب بعد (مطلوب + لم يتم) => Not pulled yet (required + not done)
لم يُفتح بعد => Not opened yet
مثال: عرض بيطري => Example: veterinary approval
مثبّت ✓ ويُستخدم كبديل لو Gemini مش متاح. => Installed ✓ and used as a fallback if Gemini is unavailable.
محادثة => Chat
مدة تحديث العدادات والتنبيهات (بالثواني، من 3 إلى 60) => Counter & alert refresh interval (seconds, 3 to 60)
مدير => Admin
مدير (كل الصلاحيات) => Admin (all permissions)
مدير النظام => System admin
مرحباً بك في INX – نظام إدارة الشحنات والتخليص الجمركي => Welcome to INX – Shipping & Customs Management System
مستخدم في => Used in
مستندات => Documents
مستندات سحب ناقصة => Missing pull documents
مستندات سحب ناقصة: => Missing pull documents:
مستندات لم تُسحب => Documents not pulled
مستندات مرفوعة => Uploaded documents
مستندات ناقصة => Missing documents
مستندات ناقصة: => Missing documents:
مسح => Clear
معاً .. لعمل أكثر تنظيماً واحترافية => Together .. for more organized and professional work
معتمد => Approved
معتمد ✓ ( => Approved ✓ (
معلق) => pending)
مفتوحة => Open
مفعّل ✓ (ينتهي بـ => Enabled ✓ (ends with
مقارنة العروض => Compare offers
مقترح => Proposed
مكتمل => Completed
ملاحظة => Note
ملاحظة: => Note:
ملخص => Summary
ملف جاهز للرفع => file(s) ready to upload
من => From
من إضافة الشحنة لحد آخر عملية، بالترتيب. => From the shipment's creation to the latest action, in order.
من تاريخ وصول => From arrival date
من فضلك استنى، وماتقفلش الصفحة => Please wait, and do not close the page
منتهية => Completed
موظف => Employee
موظف جديد => New employee
موقوف => Disabled
نسخة إلكترونية => Electronic copy
نسخة إلكترونية: => Electronic copy:
نشط => Active
نظام إدارة الشحنات => Shipment Management System
نقل / تخليص / تأمين ... => Transport / clearance / insurance ...
نوع الخدمة => Service type
نوع الشحنة => Shipment type
نوع المستند => Document type
هيظهر للموظف تنبيه على كل الصفحات لحد ما يفتح الأمر ويقرأه. وقت الإرسال ووقت القراءة بيتسجلوا. => The employee will see an alert on every page until they open and read the order. Send time and read time are recorded.
وصول من => Arrival from
يوجد => There is
✓ أُرسلت => ✓ Sent
✓✓ قُرئت => ✓✓ Read
ابحث برقم الشحنة أو العميل أو المورد أو ACID أو VAT أو البوليصة... => Search by shipment no., customer, supplier, ACID, VAT or B/L...
ابحث باسم الملف أو رقم الشحنة أو العميل... => Search by file name, shipment no. or customer...
اسم المستخدم أو كلمة المرور غير صحيحة، أو الحساب موقوف. => Incorrect username or password, or the account is disabled.
رُفع بواسطة => Uploaded by
حصل خطأ مؤقت => A temporary error occurred
جرّب تاني بعد لحظات. => Please try again in a moment.
الإدراج => Registration
استلام المستندات => Receiving documents
مراجعة المستندات => Reviewing documents
تقديم العروض والموافقات الرقابية => Submitting regulatory approvals
الإجراءات الجمركية => Customs procedures
سداد المستحقات => Payment of dues
الإفراج الجمركي => Customs release
التسليم النهائي للعميل => Final delivery to the customer
إغلاق الشحنة وتسوية الحساب => Shipment closing & account settlement
استلام ملف الشحنة من العميل والتأكد إن المستندات الأساسية وصلت. => Receive the shipment file from the customer and make sure the core documents arrived.
استلم من العميل المستندات الأصلية أو صورها. => Receive the original documents or copies from the customer.
راجع إن كل مستند موجود وواضح (مفيش صفحة ناقصة). => Check that every document is present and legible (no missing pages).
ارفع المستندات على الشحنة من قسم المستندات، واختار نوع كل مستند. => Upload the documents to the shipment from the Documents section and choose each document's type.
سجّل أي ملاحظة (مستند هيتأخر، أو العميل هيبعت تعديل). => Record any note (a document will be late, or the customer will send an amendment).
البطاقة الضريبية للمستورد => Importer's tax card
مراجعة المستندات مع بعضها قبل ما تتقدم أي إجراءات. => Cross-check the documents against each other before any procedures are submitted.
طابق اسم المستورد والمورد في الفاتورة والبوليصة. => Match the importer and supplier names on the invoice and the bill of lading.
طابق عدد الطرود والوزن والقيمة بين الفاتورة والبوليصة وقائمة التعبئة. => Match package count, weight and value across the invoice, bill of lading and packing list.
اتأكد إن رقم ACID صحيح ومطابق للشحنة، وإن بلد المنشأ مطابق للشهادة. => Make sure the ACID number is correct and matches the shipment, and that the country of origin matches the certificate.
لو فيه اختلاف، كلّم العميل أو المورد يصلحه قبل ما تكمل. => If there is a discrepancy, contact the customer or supplier to fix it before continuing.
كل مستندات المرحلة الأولى => All stage-one documents
ملاحظات المراجعة => Review notes
تسجيل الشحنة في المنظومة الجمركية وربطها ببياناتها، واستلام إذن التسليم من الخط الملاحي. => Register the shipment in the customs system, link it to its data, and receive the delivery order from the shipping line.
سجّل بيانات الشحنة (رقم البوليصة، الحاويات أو الطرود، رقم ACID). => Enter the shipment data (B/L number, containers or packages, ACID number).
اتأكد إن الشحنة ظاهرة ومربوطة بالمنفذ الجمركي المقصود. => Make sure the shipment appears and is linked to the intended customs port.
استلم إذن التسليم من الخط الملاحي بعد سداد مصاريفه. => Receive the delivery order from the shipping line after paying its charges.
سجّل رقم الإدراج في ملاحظات الشحنة. => Record the registration number in the shipment notes.
تحديد وتقديم العروض الرقابية المطلوبة للشحنة (زراعة، مصنفات، كيمياء...) ومتابعتها لحد صدور الموافقات. => Identify and submit the regulatory approvals required for the shipment (agriculture, artistic works, chemistry...) and follow them until the approvals are issued.
حدّد من قسم «العروض الرقابية» الجهات المطلوبة حسب نوع البضاعة. => From the "Regulatory approvals" section, select the required authorities according to the type of goods.
سجّل الجهة المختصة ورقم الطلب وتاريخ التقديم لكل عرض. => Record the competent authority, request number and submission date for each approval.
تابع حالة كل عرض (تم التقديم / تحت الفحص) وغيّرها أول بأول. => Track the status of each approval (submitted / under inspection) and update it as it changes.
ارفع الموافقة الصادرة وسجّل تاريخ صدورها. => Upload the issued approval and record its issue date.
كل العروض الرقابية المطلوبة بحالة «تمت الموافقة» => All required regulatory approvals in "Approved" status
صور الموافقات => Approval copies
تجهيز البيان الجمركي وإتمام المعاينة والفحص لو مطلوبين. => Prepare the customs declaration and complete the inspection and examination if required.
حدّد البند الجمركي (التصنيف) للصنف واكتبه في حقل البند. => Determine the tariff code (classification) for the item and enter it in the tariff field.
جهّز البيان الجمركي بالقيمة والمنشأ والوزن والعدد. => Prepare the customs declaration with value, origin, weight and count.
قدّم البيان وتابع حالته لحد القبول. => Submit the declaration and follow its status until accepted.
حضّر المعاينة لو اتطلبت، وتابع أي عينات أو فحص. => Prepare for inspection if requested, and follow up on any samples or tests.
البند الجمركي => Customs tariff code
الفاتورة وشهادة المنشأ => Invoice and certificate of origin
سداد الرسوم والضرائب والمصاريف المستحقة على الشحنة. => Pay the duties, taxes and charges due on the shipment.
احسب الرسوم الجمركية والضرائب من البيان الجمركي. => Calculate the customs duties and taxes from the customs declaration.
ادفع الرسوم الجمركية والضرائب. => Pay the customs duties and taxes.
سدد مصاريف الميناء والأرضيات والخط الملاحي لو مستحقة. => Pay port, storage and shipping line charges if due.
احتفظ بإيصالات السداد وارفعها على الشحنة. => Keep the payment receipts and upload them to the shipment.
البيان الجمركي => Customs declaration
رصيد أو دفعة من العميل => Balance or payment from the customer
الجمارك بتفرج عن الشحنة بعد استيفاء الإجراءات والسداد. => Customs releases the shipment after the procedures and payment are completed.
اتأكد إن كل الرسوم اتسددت والمعاينة خلصت. => Make sure all fees are paid and the inspection is finished.
استلم قرار الإفراج الجمركي وإذن خروج الشحنة. => Receive the customs release decision and the shipment exit permit.
ارفع صورة الإفراج على الشحنة. => Upload the release copy to the shipment.
نسّق مع العميل أو الناقل ميعاد خروج الشحنة. => Coordinate the shipment's exit time with the customer or carrier.
قرار أو إذن الإفراج => Release decision or permit
خروج الشحنة من الميناء وتسليمها للعميل. => The shipment leaves the port and is delivered to the customer.
رتّب النقل من الميناء لمكان العميل. => Arrange transport from the port to the customer's location.
اتأكد من العدد والحالة عند الاستلام (عدد الطرود يطابق المستندات). => Verify the count and condition on receipt (the package count matches the documents).
خلّي العميل يوقّع إيصال الاستلام. => Have the customer sign the receipt.
ارفع إيصال الاستلام على الشحنة. => Upload the receipt to the shipment.
إذن خروج الشحنة => Shipment exit permit
إيصال استلام موقّع من العميل => Receipt signed by the customer
قفل الملف حسابيًا وإداريًا بعد التسليم. => Close the file financially and administratively after delivery.
اعمل كشف حساب بكل المصاريف الفعلية للشحنة. => Prepare a statement of all actual shipment expenses.
قارنه بالدفعات المستلمة من العميل، وحدّد المتبقي أو المرتجع. => Compare it with the payments received from the customer and determine the remainder or refund.
حصّل المتبقي أو رجّع الزيادة للعميل. => Collect the remainder or refund the excess to the customer.
أرشف المستندات وغيّر المرحلة لـ "إغلاق". => Archive the documents and change the stage to "Closed".
كشف الحساب النهائي => Final account statement
إيصالات الدفع والتحصيل => Payment and collection receipts
تفريغ (Discharge) => Discharge
يورو وان (EUR.1) => EUR.1 certificate
استثمار => Investment
إيصال نولون (Freight Receipt) => Freight receipt
عقد ملحق 4 => Annex 4 contract
موافقة السياحة => Tourism approval
الفاتورة التجارية => Commercial invoice
بوليصة الشحن => Bill of lading
شهادة المنشأ => Certificate of origin
إذن التسليم => Delivery order
مستندات الجمارك => Customs documents
إيصالات السداد => Payment receipts
قرار الإفراج => Release decision
إيصال الاستلام => Receipt of delivery
مستند آخر => Other document
مطلوب => Required
لم يتم السحب => Not pulled
تم التقديم => Submitted
تحت الفحص => Under inspection
مرفوض => Rejected
عرض زراعة => Agriculture approval
عرض مصنفات => Artistic works approval
عرض كيمياء => Chemistry approval
عرض إشعاع => Radiation approval
عرض صيدلة => Pharmacy approval
عرض أمن عام => Public security approval
عرض مخدرات => Narcotics approval
واردات صناعية => Industrial imports
عرض مفرقعات => Explosives approval
موافقة رقابية: => Regulatory approval:
مستلمة => Received
رقم الأوردر (Order Number) => Order Number
الموقع => Location
عدد الطرود (Packages) => Packages
الوزن القائم (Gross Weight) كجم => Gross Weight (kg)
الوزن الصافي (Net Weight) كجم => Net Weight (kg)
قيمة الفاتورة => Invoice value
عملة الفاتورة (Currency) => Currency
التعاقد => Contract
غرض الاستخدام => Purpose of use
الصنف => Commodity
اسم المورد (Supplier) => Supplier
الرقم الضريبي للمورد (Supplier VAT No.) => Supplier VAT No.
كل العروض الرقابية المطلوبة حاصلة على موافقة => All required regulatory approvals are approved
ترقية تلقائية للمرحلة => Automatic stage promotion
المرحلة اكتملت — انتقلت الشحنة تلقائيًا إلى: => Stage completed — the shipment moved automatically to:
طلب غير صالح (CSRF) => Invalid request (CSRF)
محاولات كثيرة. حاول بعد 10 دقائق. => Too many attempts. Try again in 10 minutes.
تسجيل دخول => Sign in
تسجيل خروج => Sign out
تعذر الاتصال بـ Gemini => Could not connect to Gemini
خطأ => Error
خطأ من Gemini ( => Gemini error (
تعذر الاتصال بـ Gemini (تأكد من الإنترنت): => Could not connect to Gemini (check your internet):
Gemini لم يرجّع نتيجة (ممكن المستند اتحجب أو غير واضح). => Gemini returned no result (the document may have been blocked or unclear).
رد Gemini غير مفهوم، حاول بصورة أوضح. => Gemini's response was not understood, try a clearer image.
برنامج Tesseract غير مثبت على الجهاز. => Tesseract is not installed on this machine.
Tesseract يقرأ الصور فقط. حوّل الـ PDF لصورة أو استخدم مفتاح Gemini. => Tesseract reads images only. Convert the PDF to an image or use a Gemini key.
فشل تشغيل Tesseract: => Failed to run Tesseract:
Tesseract لم يستطع قراءة نص من الصورة. => Tesseract could not read any text from the image.
Tesseract (تعذّر Gemini: => Tesseract (Gemini unavailable:
الاسكان محتاج مفتاح Gemini (من الإعدادات) أو تثبيت Tesseract على الجهاز. => Scanning needs a Gemini key (in Settings) or Tesseract installed on this machine.
اختر صورة المستند أولاً => Choose a document image first
الاسكان يقبل صور (png / jpg / webp) أو ملف PDF فقط => Scanning accepts images (png / jpg / webp) or a PDF file only
حجم الملف أكبر من 10 ميجا، صغّر الصورة وحاول مرة أخرى => The file is larger than 10 MB, shrink the image and try again
لم أجد بيانات واضحة في المستند، جرّب صورة أوضح => No clear data found in the document, try a clearer image
غير محدد => Unspecified
إضافة شحنة => Add shipment
(اسكان بـ => (scanned via
من ملف: => from file:
حقل) => fields)
تم اسكان المستند بـ => Document scanned via
وإضافة الشحنة => and shipment added
حقل). راجع البيانات وعدّل أي خطأ. => fields). Review the data and fix any errors.
حذف مفتاح Gemini => Delete Gemini key
تم حذف المفتاح => Key deleted
المفتاح غير صالح => Invalid key
ضبط مفتاح Gemini => Set Gemini key
تم حفظ مفتاح Gemini، الاسكان جاهز => Gemini key saved, scanning is ready
اسم العميل مطلوب => Customer name is required
رقم الشحنة مستخدم من قبل => The shipment number is already used
تمت إضافة الشحنة => Shipment added
الرقم => No.
البوليصة => B/L
تعديل شحنة => Edit shipment
بدون تغيير => No change
تم حفظ التعديلات => Changes saved
تغيير مرحلة => Stage change
تم تحديث المرحلة => Stage updated
تسجيل بيانات مرحلة => Stage data entry
: التاريخ => : date
| المسؤول => | responsible
تم حفظ تاريخ المرحلة والمسؤول => Stage date and responsible saved
إضافة ملاحظة => Add note
حذف شحنة => Delete shipment
تم حذف الشحنة (محفوظة في السجل) => Shipment deleted (kept in the log)
اختر ملفًا أولاً => Choose a file first
نوع الملف غير مسموح: => File type not allowed:
رفع مستند => Upload document
تم رفع => Uploaded
مستند => Document
تحميل مستند => Download document
حذف مستند => Delete document
تم حذف المستند (الملف محفوظ في النسخ الاحتياطي) => Document deleted (the file is kept in the backup)
اختر نوع مستند واحد على الأقل => Choose at least one document type
تحديد مستندات مطلوبة للسحب => Specify documents required for pulling
تمت إضافة => Added
مستند لقائمة السحب => document(s) to the pull list
المستندات المختارة موجودة بالفعل في القائمة => The selected documents are already in the list
سحب مستند => Document pull
| التاريخ => | date
تم تحديث حالة المستند => Document status updated
إلغاء مستند من قائمة السحب => Remove document from pull list
(كان: => (was:
تم إلغاء المستند من القائمة (الملفات المرفوعة لم تُحذف) => Document removed from the list (uploaded files were not deleted)
اختر عرضًا رقابيًا واحدًا على الأقل => Choose at least one regulatory approval
إضافة عروض رقابية => Add regulatory approvals
: تمت إضافة عروض رقابية مطلوبة ( => : required regulatory approvals added (
عرض رقابي => Regulatory approval
العروض المختارة موجودة بالفعل على الشحنة => The selected approvals already exist on the shipment
| الجهة => | authority
| رقم الطلب => | request no.
| تاريخ الموافقة => | approval date
: الحالة أصبحت « => : status became «
» (بواسطة => » (by
تم تحديث العرض الرقابي => Regulatory approval updated
وإرسال تنبيه => and alert sent
حذف عرض رقابي => Delete regulatory approval
، الجهة: => , authority:
، رقم الطلب: => , request no.:
تم حذف العرض الرقابي من الشحنة (الملفات المرفوعة لم تُحذف، والعملية في السجل) => Regulatory approval deleted from the shipment (uploaded files were not deleted, and the action is in the log)
العرض الرقابي => Regulatory approval
رقم الطلب/المعاملة => Request/transaction No.
تاريخ صدور الموافقة => Approval issue date
المسؤول عن المتابعة => Follow-up owner
تصدير تقرير العروض الرقابية => Export regulatory approvals report
اكتب اسم العرض => Enter the approval name
هذا العرض موجود بالفعل => This approval already exists
إضافة نوع عرض رقابي => Add regulatory approval type
تمت إضافة النوع => Type added
تفعيل/إيقاف نوع عرض رقابي => Enable/disable regulatory approval type
اسم الجهة المقدمة للعرض مطلوب => The offer provider name is required
السعر لازم يكون رقم صحيح => The price must be a valid number
إضافة عرض => Add offer
عرض # => Offer #
: عرض جديد من => : new offer from
بسعر => at price
(أضافه => (added by
تمت إضافة العرض => Offer added
اعتماد عرض => Approve offer
: تم اعتماد عرض => : offer approved
) بواسطة => ) by
تم اعتماد العرض => Offer approved
إلغاء اعتماد عرض => Revoke offer approval
تم إلغاء الاعتماد => Approval revoked
لا يمكن حذف عرض معتمد (ألغِ اعتماده أولاً) => An approved offer cannot be deleted (revoke its approval first)
حذف عرض => Delete offer
تم حذف العرض (محفوظ في السجل) => Offer deleted (kept in the log)
الشات العام (كل الموظفين) => General chat (all employees)
اختر الموظف => Choose an employee
الموظف غير موجود => Employee not found
اكتب رسالة أو أرفق ملفًا => Type a message or attach a file
رقم الشحنة غير صحيح => Invalid shipment number
اختر الشحنة والموظف واكتب عنوان الأمر => Choose the shipment and employee and enter the order title
تم إرسال الأمر وسيظهر للموظف كتنبيه حتى يفتحه => Order sent; it will show as an alert to the employee until they open it
قراءة أمر => Read order
تغيير حالة أمر => Change order status
تم تحديث حالة الأمر => Order status updated
مكتملة => Completed
قيد الإجراءات => In progress
تحت المراجعة => Under review
رقم الأمر => Order No.
العنوان => Title
وقت الإرسال => Sent at
وقت القراءة => Read at
وقت البدء => Started at
وقت الإكمال => Completed at
تصدير تقرير الأوامر => Export orders report
مستندات سحب لم تُسحب => Pull documents not pulled
تصدير تقرير => Export report
أكمل البيانات (كلمة المرور 6 أحرف على الأقل) => Complete the data (password at least 6 characters)
اسم المستخدم موجود => The username already exists
إضافة موظف => Add employee
تمت إضافة الموظف => Employee added
كلمة المرور قصيرة => The password is too short
(إيقاف) => (disabled)
تم الحفظ => Saved
أمر => Order
سحب => Pull
النسخ الاحتياطي يتم من Aiven (البيانات والملفات كلها على قاعدة البيانات) => Backups are handled by Aiven (all data and files are in the database)
النسخ الاحتياطي يتم من Aiven (البيانات والملفات محفوظة على قاعدة البيانات) => Backups are handled by Aiven (all data and files are stored in the database)
كلمة المرور الحالية غير صحيحة => The current password is incorrect
كلمة المرور الجديدة غير متطابقة أو قصيرة => The new passwords do not match or are too short
تم تغيير كلمة المرور => Password changed
تم حفظ إعدادات الإشعارات والعدادات => Notification and counter settings saved
نسخة احتياطية => Backup
الاستعادة غير متاحة مع قاعدة بيانات Aiven، استخدم نسخ Aiven الاحتياطية => Restore is not available with an Aiven database, use Aiven's backups
اختر ملف نسخة احتياطية (zip) => Choose a backup file (zip)
ملف غير صالح => Invalid file
تمت استعادة البيانات => Data restored
فشلت الاستعادة: => Restore failed:
ليست لديك صلاحية لهذا الإجراء => You do not have permission for this action
الصفحة غير موجودة => Page not found
طلب غير صالح => Invalid request
مرفوض => Rejected
تم السحب => Pulled
''')

# ======================================================== English => عربي
AR = _parse(r'''
INX – Shipping & Customs Management System => INX – نظام إدارة الشحنات والتخليص الجمركي
INX – Shipping & Customs => INX – الشحن والتخليص الجمركي
Management System => نظام الإدارة
Shipment No. => رقم الشحنة
Customer => العميل
Supplier => المورد
ACID No. => رقم ACID
VAT No. => الرقم الضريبي
Packages => الطرود
Weight G/N => القائم / الصافي
Supplier VAT No. => الرقم الضريبي للمورد
Shipping Co. => شركة الشحن
Employee => الموظف المسؤول
Status => الحالة
VAT / الرقم الضريبي => الرقم الضريبي
VAT المورد => الرقم الضريبي للمورد
العروض الرقابية (Regulatory Approvals) => العروض الرقابية
رقم الأوردر (Order Number) => رقم الأوردر
عدد الطرود (Packages) => عدد الطرود
الوزن القائم (Gross Weight) كجم => الوزن القائم كجم
الوزن الصافي (Net Weight) كجم => الوزن الصافي كجم
عملة الفاتورة (Currency) => عملة الفاتورة
اسم المورد (Supplier) => اسم المورد
الرقم الضريبي للمورد (Supplier VAT No.) => الرقم الضريبي للمورد
تفريغ (Discharge) => تفريغ
إيصال نولون (Freight Receipt) => إيصال نولون
''')


def _build(d, letters, minlen):
    """regex واحد لكل المفاتيح (الأطول الأول). حدود الكلمة بتتطبّق بس على الأطراف اللي هي حروف."""
    keys = [k for k in d if len(k) >= minlen or k in SHORT_OK]
    keys.sort(key=len, reverse=True)
    if not keys:
        return None
    is_l = re.compile("[%s]" % letters)

    def alt(k):
        pre = "(?<![%s])" % letters if is_l.match(k[0]) else ""
        post = "(?![%s])" % letters if is_l.match(k[-1]) else ""
        return pre + re.escape(k) + post
    return re.compile("|".join(alt(k) for k in keys))


RX_EN = _build(EN, AR_LETTERS, 5)
RX_AR = None  # في الوضع العربي: مطابقة كاملة بس (عشان ما نبوّظش بيانات إنجليزي كتبها المستخدم)
BI_RX = re.compile(r"([A-Za-z][^<>]*?)<br>\s*<small>([^<>]*)</small>")
OPT_RX = re.compile(r"<option(?![^>]*\bvalue\s*=)([^>]*)>([^<]*)</option>", re.I)
PROTECT_RX = re.compile(r"(<script\b[^>]*>)(.*?)(</script>)|(<style\b[^>]*>.*?</style>)|(<textarea\b[^>]*>)(.*?)(</textarea>)", re.S | re.I)
SPLIT_RX = re.compile(r"(<!--.*?-->|<[^>]+>)", re.S)
ATTR_RX = re.compile(r"""(\s(?:placeholder|title|aria-label|alt|onsubmit|onclick)=)("([^"]*)"|'([^']*)')""")
TAG_RX = re.compile(r"<(/?)([a-zA-Z][\w:-]*)")
VOID = {"br", "hr", "img", "input", "meta", "link", "col", "area", "base", "source", "wbr"}


def current_lang():
    try:
        l = request.cookies.get(COOKIE)
    except RuntimeError:
        return "ar"
    return l if l in ("ar", "en") else "ar"


@lru_cache(maxsize=30000)
def tr_str(s, lang):
    d, rx, probe = (EN, RX_EN, AR_RE) if lang == "en" else (AR, RX_AR, LAT_RE)
    if s in d:
        return d[s]
    out = rx.sub(lambda m: d[m.group(0)], s) if rx and probe.search(s) else s
    return out


def tr_text(raw, lang):
    if not raw.strip():
        return raw
    t = _h.unescape(raw)
    lead, trail = t[: len(t) - len(t.lstrip())], t[len(t.rstrip()):]
    core = re.sub(r"\s+", " ", t.strip())
    out = tr_str(core, lang)
    return raw if out == core else _h.escape(lead + out + trail, quote=False)


def _attr_esc(s, q):
    s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return s.replace(q, "&quot;" if q == '"' else "&#39;")


def tr_tag(tag, lang):
    def rep(m):
        q = m.group(2)[0]
        raw = m.group(3) if m.group(3) is not None else m.group(4)
        t = _h.unescape(raw)
        out = tr_str(re.sub(r"\s+", " ", t.strip()), lang)
        if out == re.sub(r"\s+", " ", t.strip()):
            return m.group(0)
        return m.group(1) + q + _attr_esc(out, q) + q
    return ATTR_RX.sub(rep, tag)


def tr_script(js, lang):
    if lang != "en" or not RX_EN:
        return js

    def rep(m):  # الاقتباسات لازم تتهرّب عشان ماتكسرش الـ JS
        return EN[m.group(0)].replace("\\", "\\\\").replace("'", "\\'").replace('"', '\\"')
    return RX_EN.sub(rep, js)


def tr_html(doc, lang):
    doc = OPT_RX.sub(lambda m: '<option value="%s"%s>%s</option>' % (
        _h.escape(_h.unescape(m.group(2)).strip(), quote=True), m.group(1), m.group(2)), doc)
    doc = BI_RX.sub(lambda m: m.group(1) if lang == "en" else m.group(2), doc)
    kept = []

    def protect(m):
        if m.group(1):
            kept.append(tr_script(m.group(2), lang))
            return m.group(1) + "\x00%d\x00" % (len(kept) - 1) + m.group(3)
        if m.group(4):
            kept.append(m.group(4))
            return "\x00%d\x00" % (len(kept) - 1)
        kept.append(m.group(6))
        return m.group(5) + "\x00%d\x00" % (len(kept) - 1) + m.group(7)

    doc = PROTECT_RX.sub(protect, doc)
    out, skip, depth = [], None, 0
    for i, part in enumerate(SPLIT_RX.split(doc)):
        if i % 2 == 0:
            out.append(part if skip else tr_text(part, lang))
            continue
        if part.startswith("<!--"):
            out.append(part)
            continue
        m = TAG_RX.match(part)
        name = m.group(2).lower() if m else ""
        if skip:
            if name == skip:
                depth += -1 if m.group(1) else 1
                if depth == 0:
                    skip = None
            out.append(part)
            continue
        if m and not m.group(1):
            part = tr_tag(part, lang)
            if " data-nt" in part and not part.endswith("/>") and name not in VOID:
                skip, depth = name, 1
        out.append(part)
    doc = "".join(out)
    doc = re.sub(r"\x00(\d+)\x00", lambda m: kept[int(m.group(1))], doc)
    if lang == "en":
        doc = re.sub(r'(<html\b[^>]*?)\blang="ar"', r'\1lang="en"', doc)
        doc = re.sub(r"""\bdir=(["']?)rtl\1""", lambda m: "dir=%sltr%s" % (m.group(1), m.group(1)), doc)
    return doc


def _walk_json(o, lang, key=None):
    if isinstance(o, dict):
        return {k: _walk_json(v, lang, k) for k, v in o.items()}
    if isinstance(o, list):
        return [_walk_json(v, lang, key) for v in o]
    if isinstance(o, str):
        if key == "html":
            return tr_html(o, lang)
        if key in ("message", "msg", "error"):
            return tr_str(re.sub(r"\s+", " ", o.strip()), lang)
    return o


def init(app):
    @app.context_processor
    def _lang_ctx():
        lang = current_lang()
        return {"LANG": lang, "LANG_TO": "en" if lang == "ar" else "ar"}

    @app.route("/lang/<code>")
    def set_lang(code):
        code = code if code in ("ar", "en") else "ar"
        ref = request.referrer or ""
        ok = ref and urlparse(ref).netloc == request.host and "/lang/" not in ref
        resp = redirect(ref if ok else url_for("home"))
        resp.set_cookie(COOKIE, code, max_age=31536000, samesite="Lax")
        return resp

    @app.after_request
    def _translate(resp):
        if resp.direct_passthrough or request.endpoint == "static" or resp.status_code in (301, 302, 303, 307, 308):
            return resp
        lang = current_lang()
        if resp.mimetype == "text/html":
            resp.set_data(tr_html(resp.get_data(as_text=True), lang))
        elif resp.mimetype == "application/json":
            data = resp.get_json(silent=True)
            if data is not None:
                import json
                resp.set_data(json.dumps(_walk_json(data, lang), ensure_ascii=False))
        return resp
