"use strict";

// Client-side English <-> Hinglish UI translation (the existing "hi" locale).
// Month names stay in English in both languages.
// Default is English ("en"). Printed bill sheets (.sheet), file paths (.config-path), input values,
// and user data (party/finish/colour/group/style names, numbers, addresses, GSTINs, bill numbers) are never translated.
(() => {
  const EXACT = {
    // App shell & navigation
    "MPH Register": "MPH Register",
    "Print bills — MPH Register": "बिल Print — MPH Register",
    "New Entry": "नई Entry",
    "Register": "रजिस्टर",
    "Party-wise": "Party-wise",
    "Bills": "बिल",
    "Masters": "Masters",
    "Import Excel": "Excel Import",
    "Register month": "रजिस्टर Month",
    "All financial years": "सभी Financial Years",
    "From workbook": "Workbook से",
    "No bills match the selected period and search.": "चुनी गई अवधि और Search से कोई बिल Match नहीं हुआ।",
    "April to March": "April से March",
    "No entries in this financial year.": "इस Financial Year में कोई Entry नहीं है।",
    "No entries yet.": "अभी कोई Entry नहीं है।",
    "Menu": "मेन्यू",
    "Open menu": "मेन्यू खोलें",
    "Language": "Language",
    "Theme": "Theme",
    "☀ Light": "☀ लाइट",
    "☾ Dark": "☾ डार्क",
    "Settings": "Settings",
    "Firm details, bill rules, printing and features": "Firm Details, बिल Rules, Printing और Features",
    "☾ Dark mode": "☾ डार्क मोड",
    "☀ Light mode": "☀ लाइट मोड",
    "Switch between light and dark screens": "लाइट और डार्क स्क्रीन के बीच बदलें",

    // Notices & common actions
    "Hide": "Hide करें",
    "Close": "Close करें",
    "Close (Esc)": "Close करें (Esc)",
    "Cancel": "Cancel करें",
    "Save": "Save करें",
    "Save changes": "बदलाव Save करें",
    "Edit": "Edit करें",
    "Delete": "Delete करें",
    "Remove": "Remove करें",
    "Clear": "Clear करें",
    "Discard": "Discard करें",
    "Print": "Print करें",
    "Save as PDF": "PDF Save करें",
    "Making PDF…": "PDF बन रहा है…",
    "Making the PDF…": "PDF बन रहा है…",
    "PDF saved ✓": "PDF Save हो गया ✓",
    "PDF saved to your Downloads folder.": "PDF आपके Downloads Folder में Save हो गया।",
    "Could not save PDF": "PDF Save नहीं हो सका",
    "OK": "ठीक है",
    "Confirm": "Confirm करें",
    "Notice": "Notice",
    "Unsaved changes": "बदलाव Save नहीं हुए",
    "Close without saving your changes?": "बदलाव Save किए बिना Close करें?",
    "Discard changes": "बदलाव Discard करें",
    "Keep editing": "Edit करते रहें",
    "Cancel bill": "बिल Cancel करें",
    "Keep bill": "बिल रखें",
    "The number stays used and the bill is marked CANCELLED. Its entries become unbilled so they can be billed again.": "नंबर इस्तेमाल में रहेगा और बिल CANCELLED हो जाएगा। इसकी Entries फिर से बिना बिल हो जाएँगी ताकि दोबारा बिल बन सके।",
    "Rename party": "पार्टी का नाम बदलें",
    "Rename finish": "फ़िनिश का नाम बदलें",
    "Rename": "नाम बदलें",
    "Delete rate": "Rate Delete करें",
    "Delete billing style": "Billing Style Delete करें",
    "The config file needs attention": "कॉन्फ़िग फ़ाइल पर ध्यान देना ज़रूरी है",
    "Notes about the data folder": "डेटा फ़ोल्डर के बारे में सूचनाएँ",

    // New versions (side menu, update bar, update windows)
    "App version": "App Version",
    "Check for updates": "Update Check करें",
    "Checking…": "Check हो रहा है…",
    "Update now": "अभी Update करें",
    "What's new": "क्या नया है",
    "Later": "बाद में",
    "Updates install only in the Windows app (MPH Register.exe).": "Update केवल Windows App (MPH Register.exe) में Install होते हैं।",
    "Could not check for a new version. Is the internet on?": "नया Version Check नहीं हो सका। क्या Internet चालू है?",
    "No version has been published yet.": "अभी कोई Version Publish नहीं हुआ है।",
    "The newest release has no version number.": "नई Release में Version Number नहीं है।",
    "GitHub's answer could not be read. Try again later.": "GitHub का जवाब पढ़ा नहीं जा सका। बाद में फिर कोशिश करें।",
    "Could not download the new version. Check the internet and try again.": "नया Version Download नहीं हो सका। Internet Check करके फिर कोशिश करें।",
    "The downloaded file was not complete. Try again.": "Download की गई File पूरी नहीं थी। फिर कोशिश करें।",
    "The new version is already being downloaded.": "नया Version पहले से Download हो रहा है।",
    "Save any entry you are typing first. The app then downloads the new version, closes and opens again by itself.":
      "पहले जो Entry लिख रहे हैं उसे Save करें। फिर App नया Version Download करेगा, बंद होगा और अपने-आप फिर से खुल जाएगा।",
    "Your entries, bills and settings stay as they are.": "आपकी Entries, बिल और Settings जैसे हैं वैसे ही रहेंगे।",
    "Downloading the new version… Keep the app open.": "नया Version Download हो रहा है… App खुला रखें।",
    "Opening the new version… This takes a few seconds.": "नया Version खुल रहा है… इसमें कुछ Seconds लगते हैं।",
    "The app did not open again. Open MPH Register from the desktop.": "App फिर से नहीं खुला। Desktop से MPH Register खोलें।",
    "The update did not finish, so this is still the old version. Try again later.": "Update पूरा नहीं हुआ, इसलिए यह अभी पुराना Version है। बाद में फिर कोशिश करें।",
    "Go back to the previous version": "पिछले Version पर वापस जाएँ",
    "Go back to the previous version?": "पिछले Version पर वापस जाएँ?",
    "Go back and undo changes": "वापस जाएँ और बदलाव हटाएँ",
    "Save any entry you are typing first. The app then closes and opens again as the older version.":
      "पहले जो Entry लिख रहे हैं उसे Save करें। फिर App बंद होगा और पुराने Version के रूप में फिर से खुल जाएगा।",
    "Today's data is kept as a copy in the data folder (rollback), so it can still be recovered.":
      "आज का Data, Data Folder (rollback) में Copy के रूप में रखा जाता है, ताकि उसे बाद में वापस लाया जा सके।",
    "Going back to the older version… Keep the app open.": "पुराने Version पर वापस जा रहे हैं… App खुला रखें।",
    "Opening the older version… This takes a few seconds.": "पुराना Version खुल रहा है… इसमें कुछ Seconds लगते हैं।",
    "There is no earlier version to go back to.": "वापस जाने के लिए कोई पुराना Version नहीं है।",
    "Going back now undoes the changes made since the update. Confirm that first.": "अभी वापस जाने से Update के बाद किए गए बदलाव हट जाएँगे। पहले इसे Confirm करें।",
    "No match": "कोई Match नहीं",
    "inactive": "Inactive",
    "Inactive": "Inactive",
    "Not set": "Set नहीं है",
    "Billed before dispatch": "जावक से पहले बिल",
    "Active": "Active",
    "Active (shows in lists)": "Active (Lists में दिखेगा)",
    "Mark inactive": "Inactive करें",
    "Mark active": "Active करें",
    "Yes": "हाँ",
    "No": "नहीं",
    "Saved": "Save हो गया",
    "Saved ✓": "Save हो गया ✓",
    "CANCELLED": "CANCELLED",
    "App": "ऐप",
    "Excel": "Excel",

    // New entry screen
    "New inward entry": "नई आवक Entry",
    "Cancel correction (Esc)": "Correction Cancel करें (Esc)",
    "INW. NO.": "आवक सं.",
    "DATE": "Date",
    "PARTY": "पार्टी",
    "D.N.": "डिज़ाइन नं.",
    "LOT N.": "लॉट नं.",
    "LOT NO.": "लॉट नं.",
    "REP.": "रिपेयर",
    "THAN": "थान",
    "TP": "टीपी",
    "NAG": "नग",
    "FINISH": "फ़िनिश",
    "NETT THAN": "नेट थान",
    "TWO PART": "टू पार्ट",
    "Type to search party": "पार्टी Search करने के लिए लिखें",
    "Type to search finish": "फ़िनिश Search करने के लिए लिखें",
    "Fill the boxes from left to right. Press Enter to go to the next box. Enter on TWO PART saves the entry.":
      "बाएँ से दाएँ Boxes भरें। अगले Box पर जाने के लिए Enter दबाएँ। टू पार्ट पर Enter दबाने से Entry Save हो जाती है।",
    "auto": "Auto",
    "Worked out by the app: THAN + TP": "ऐप स्वयं गिनता है: थान + टीपी",
    "Worked out by the app: THAN, or 0 for a repair": "ऐप स्वयं गिनता है: थान, या रिपेयर होने पर 0",
    "Dispatch (JAWAK)": "जावक (JAWAK)",
    "Leave the row empty if nothing has been sent yet.": "अगर अभी कुछ नहीं भेजा गया है तो Row खाली छोड़ दें।",
    "NAG + TWO PART": "नग + टू पार्ट",
    "Sent (JAWAK)": "भेजे गए (जावक)",
    "+ Add another dispatch": "+ एक और जावक Add करें",
    "Remove this dispatch row": "यह जावक Row Remove करें",
    "JAWAK NAG": "जावक नग",
    "GATE PASS NO": "गेट पास नं.",
    "SHORT THAN": "शॉर्ट थान",
    "Save entry (Enter)": "Entry Save करें (Enter)",
    "Save correction": "Correction Save करें",
    "Edit cancelled.": "Edit Cancel कर दिया गया।",
    "Numbers must be whole numbers.": "Numbers पूरे होने चाहिए, Decimal नहीं।",
    "Delete entry": "Entry Delete करें",
    "Keep entry": "Entry रखें",
    "Delete this entry?": "यह Entry Delete करें?",
    "Delete this entry (it can be restored from Register → Deleted entries)": "यह Entry Delete करें (रजिस्टर → Delete की गई Entries से वापस लाई जा सकती है)",
    "It moves to Register → Deleted entries and can be restored from there, as long as nothing has taken its INW. NO. or slip.":
      "यह रजिस्टर → Delete की गई Entries में चली जाएगी और वहाँ से वापस लाई जा सकती है, जब तक इसका आवक सं. या Slip किसी और ने न ले ली हो।",
    "Entry not deleted": "Entry Delete नहीं हुई",
    "Undo": "Undo करें",
    "Deleted entries": "Delete की गई Entries",
    "Entries deleted in the app; restore one from here": "ऐप में Delete की गई Entries; यहाँ से वापस लाएँ",
    "Restore": "वापस लाएँ",
    "Restore entry": "Entry वापस लाएँ",
    "Restore this entry?": "यह Entry वापस लाएँ?",
    "This entry cannot be restored": "यह Entry वापस नहीं लाई जा सकती",
    "It goes back into the register as it was when it was deleted.": "यह रजिस्टर में वैसी ही वापस आएगी जैसी Delete करते समय थी।",
    "Entries deleted in the app stay here until they are restored or deleted permanently. One can be restored while its INW. NO. and slip are still free.":
      "ऐप में Delete की गई Entries वापस लाए जाने या हमेशा के लिए Delete किए जाने तक यहीं रहती हैं। Entry तभी वापस आ सकती है जब उसका आवक सं. और Slip अभी भी खाली हों।",
    "Delete all permanently": "सब हमेशा के लिए Delete करें",
    "Remove every deleted entry for good; none can be restored afterwards": "हर Delete की गई Entry हमेशा के लिए हटाएँ; इसके बाद कोई वापस नहीं लाई जा सकेगी",
    "Delete all permanently?": "सब हमेशा के लिए Delete करें?",
    "The deleted entry will be removed for good and cannot be restored.": "Delete की गई Entry हमेशा के लिए हट जाएगी और वापस नहीं लाई जा सकेगी।",
    "Importing a workbook again can bring back any of these rows that it still contains.": "Workbook दोबारा Import करने पर, उसमें बची इन Rows में से कोई भी वापस आ सकती है।",
    "Delete permanently": "हमेशा के लिए Delete करें",
    "Keep them": "रहने दें",
    "Entries not deleted": "Entries Delete नहीं हुईं",
    "No deleted entries.": "कोई Delete की गई Entry नहीं है।",
    "This entry is no longer among the deleted entries.": "यह Entry अब Delete की गई Entries में नहीं है।",
    "Something now clashes with this entry; see the reasons below": "अब कोई दूसरी Entry इससे टकरा रही है; नीचे कारण देखें",
    "From Excel": "Excel से",
    "Recently saved here": "हाल ही में Save की गई Entries",
    "Click a row to correct it": "Correction के लिए किसी Row पर Click करें",
    "Click a cell to edit it; click INW. NO. to open the whole entry": "Edit करने के लिए Cell पर Click करें; पूरी Entry खोलने के लिए आवक सं. पर Click करें",
    "Click an INW. NO. to open the whole entry": "पूरी Entry खोलने के लिए आवक सं. पर Click करें",
    "Not saved yet: fill JAWAK NAG and GATE PASS NO": "अभी Save नहीं हुआ: जावक नग और गेट पास नं. भरें",
    "Dispatch not saved: it needs both JAWAK NAG and GATE PASS NO.": "जावक Save नहीं हुई: जावक नग और गेट पास नं. दोनों ज़रूरी हैं।",
    "REP. set to Yes: LOT N. or D.N. is marked R (repair).": "रिपेयर हाँ कर दिया: LOT N. या D.N. पर R (रिपेयर) लिखा है।",
    "Remove this dispatch?": "यह जावक हटाएँ?",
    "Remove dispatch": "जावक हटाएँ",
    "Keep it": "रहने दें",
    "Nothing has been entered in the app yet.": "ऐप में अभी तक कोई Entry नहीं की गई है।",

    // Register & Party-wise screens
    "Month": "Month",
    "All months": "सभी Months",
    "Search": "Search",
    "Party": "पार्टी",
    "Show all": "सभी दिखाएँ",
    "Expand all": "सभी खोलें",
    "Collapse all": "सभी बंद करें",
    "Open every party and finish": "हर पार्टी और Finish खोलें",
    "Close every party": "हर पार्टी बंद करें",
    "Party, design, lot, gate pass…": "पार्टी, डिज़ाइन, लॉट, गेट पास…",
    "All parties (type to filter)": "सभी पार्टियाँ (Filter के लिए लिखें)",
    "Row filters: click to include, or open options to exclude": "Row Filters: शामिल करने के लिए Click करें, छिपाने के लिए Options खोलें",
    "No entries match the search and filters.": "Search और Filters से कोई Entry Match नहीं हुई।",
    "No entries in this month.": "इस Month में कोई Entry नहीं है।",
    "No entries in these months.": "इन Months में कोई Entry नहीं है।",
    "No entries match the filters.": "Filters से कोई Entry Match नहीं हुई।",
    "No entries.": "कोई Entry नहीं।",
    "(no finish)": "(कोई फ़िनिश नहीं)",
    "1 entry": "1 Entry",
    "MORE JAWAK": "अन्य जावक",
    "BALANCE": "Balance",
    "BILL NO.": "बिल नं.",
    "WARNINGS": "Warnings",

    // Row filters
    "Dispatch": "जावक",
    "Include any dispatch states to show, or exclude states to hide": "दिखाने वाली जावक स्थितियाँ शामिल करें, या छिपाने वाली स्थितियाँ चुनें",
    "Nothing": "कुछ नहीं",
    "Nothing dispatched yet": "अभी तक कोई जावक नहीं हुई",
    "Partly": "Partial",
    "Partly dispatched: some still to send": "Partial जावक: कुछ माल भेजना बाकी है",
    "Completed": "Complete",
    "Completed: nothing left to dispatch": "Complete: अब कुछ भेजना बाकी नहीं",
    "Over": "अधिक",
    "Over-dispatched: more sent than NAG + TWO PART": "अधिक जावक: नग + टू पार्ट से अधिक माल भेजा गया",
    "All zero": "सब ज़ीरो",
    "All zero: slip kept only for its number; its THAN were entered and billed in an earlier register": "सब ज़ीरो: Slip सिर्फ़ नंबर के लिए रखी है; इसके थान पिछले रजिस्टर में चढ़े और उसी में बिल हुए",
    "Slips": "Slips",
    "Save an all-zero entry?": "सब ज़ीरो वाली Entry Save करें?",
    "THAN, TP and TWO PART are all 0 and nothing is dispatched.": "थान, टीपी और टू पार्ट सब 0 हैं और कोई जावक नहीं है।",
    "Save all-zero entry": "सब ज़ीरो Entry Save करें",
    "Go back": "वापस जाएँ",
    "Bill": "बिल",
    "Other": "अन्य",
    "Include any bill types to show, or exclude types to hide": "दिखाने वाले बिल प्रकार शामिल करें, या छिपाने वाले प्रकार चुनें",
    "Bill no.": "बिल नं.",
    "Blank": "खाली",
    "BILL NO. holds a saved bill number (click it to open that bill)": "बिल नं. में Saved बिल का नंबर है (उस बिल को खोलने के लिए क्लिक करें)",
    "BILL NO. is empty and the party needs a bill": "बिल नं. खाली है और पार्टी को बिल चाहिए",
    "No bill needed": "बिल की ज़रूरत नहीं",
    "no bill needed": "बिल की ज़रूरत नहीं",
    "The party is marked No bill needed in Masters, so BILL NO. stays empty": "Masters में पार्टी पर \"बिल की ज़रूरत नहीं\" लगा है, इसलिए बिल नं. खाली रहता है",
    "No bill needed (this party is never billed)": "बिल की ज़रूरत नहीं (इस पार्टी का बिल कभी नहीं बनता)",
    "No bill needed for this party.": "इस पार्टी के लिए बिल की ज़रूरत नहीं है।",
    "This party is marked No bill needed, so no bills are made for it.": "इस पार्टी पर \"बिल की ज़रूरत नहीं\" लगा है, इसलिए इसके बिल नहीं बनते।",
    "Change in Masters": "Masters में बदलें",
    "BILL NO. holds something else, such as a note that it was billed outside the app": "बिल नं. में कुछ और है, जैसे ऐप के बाहर बिल होने का Note",
    "Open this bill in Saved bills": "इस बिल को Saved bills में खोलें",
    "Each included condition must match; any excluded condition hides the row": "सभी शामिल शर्तें Match होनी चाहिए; कोई भी छिपाने वाली शर्त Match हो तो Row नहीं दिखेगी",
    "Repair": "रिपेयर",
    "REP. is Yes: NETT THAN is 0 and it is never billed": "रिपेयर हाँ है: नेट थान 0 है और इसका बिल नहीं बनता",
    "Carryover": "कैरीओवर",
    "Slip repeated from the previous month's register": "पिछले Month के रजिस्टर से आगे लाई गई Slip",
    "Has balance": "Balance बाकी है",
    "Still to dispatch: BALANCE is above 0, so some stock is still with you": "भेजना बाकी: Balance 0 से ज़्यादा है, यानी कुछ माल अभी आपके पास है",
    "Has warning": "Warning है",
    "Point at the row to read the warning": "Warning पढ़ने के लिए Row पर Cursor ले जाएँ",
    "Last import": "पिछला Import",
    "What the latest import of each month's inward workbook did: include New or Updated to see those entries":
      "हर माह की आवक Workbook के पिछले Import ने क्या किया: वे Entries देखने के लिए नई या Update हुई शामिल करें",
    "New": "नई",
    "Updated": "Update हुई",
    "Added as a new row by the latest import of its month's workbook": "अपने माह की Workbook के पिछले Import में नई Row के रूप में जुड़ी",
    "Changed by the latest import of a month's workbook (a later month's carryover rows can change an earlier entry). Point at the row to see what changed":
      "किसी माह की Workbook के पिछले Import से बदली (बाद के माह की कैरीओवर Rows पहले की Entry बदल सकती हैं)। क्या बदला यह देखने के लिए Row पर Cursor ले जाएँ",
    "Any": "कोई भी",
    "Include": "शामिल करें",
    "Exclude": "छिपाएँ",
    "Do not filter on this category": "इस Category पर Filter न लगाएँ",
    "Show matching rows": "Match होने वाली Rows दिखाएँ",
    "Hide matching rows": "Match होने वाली Rows छिपाएँ",
    "Category matches before exclusions": "Rows छिपाने से पहले इस Category की गिनती",
    "Clear all include and exclude filters": "सभी शामिल और छिपाने वाले Filters हटाएँ",
    "Clear filters": "Filters Clear करें",
    "Filters": "Filters",
    "Show or hide the row filters": "Row Filters दिखाएँ या छिपाएँ",
    "Clear search": "Search Clear करें",

    // Totals labels
    "Entries": "Entries",
    "Balance": "Balance",
    "Warnings": "Warnings",
    "Entries:": "Entries:",
    "THAN:": "थान:",
    "TP:": "टीपी:",
    "NAG:": "नग:",
    "NETT THAN:": "नेट थान:",
    "TWO PART:": "टू पार्ट:",
    "JAWAK NAG:": "जावक नग:",
    "Balance:": "Balance:",
    "Warnings:": "Warnings:",
    "Bills:": "बिल:",
    "Total:": "Total:",
    "Total of all bills:": "सभी बिलों का Total:",
    "Entries linked:": "Linked Entries:",
    "Lines not linked:": "Unlinked Lines:",

    // Bills screens
    "Make bills": "बिल बनाएँ",
    "Saved bills": "Saved बिल",
    "Import Excel bills": "Excel बिल Import",
    "Set bill dates": "बिल की Dates Set करें",
    "Choose the bill month, bill date, and inward entry period.": "बिल Month, बिल Date और आवक Entries का Period चुनें।",
    "Bill month": "बिल Month",
    "Bill date": "बिल Date",
    "Period from": "Period से",
    "Period to": "Period तक",
    "Entries from": "Entries से",
    "Entries to": "Entries तक",
    "Review before saving.": "Save करने से पहले बिल Check करें।",
    "Bill dates": "बिल की Dates",
    "Bill review": "बिल Check",
    "Parties to bill": "बिल बनाने के लिए पार्टियाँ",
    "Find a party": "पार्टी खोजें",
    "Only entries without a bill are shown.": "केवल बिना बिल वाली Entries दिखाई गई हैं।",
    "Selected": "चुनी गई",
    "Who are you billing?": "किस पार्टी का बिल बनाना है?",
    "Choose a party from the list to see its entries.": "Entries देखने के लिए सूची से पार्टी चुनें।",
    "Already-sent entries are selected for you. Nothing is saved until you confirm.": "भेजी गई Entries पहले से चुनी हैं। Confirm करने तक कुछ Save नहीं होगा।",
    "Party details": "पार्टी का विवरण",
    "Fix party details": "पार्टी का विवरण सुधारें",
    "Open Masters → Parties to fix this party.": "इस पार्टी को सुधारने के लिए Masters → पार्टियाँ खोलें।",
    "Entries to bill": "बिल की Entries",
    "Unsent entries are included. Untick any you do not want to bill.": "न भेजी गई Entries भी चुनी हैं। जिनका बिल नहीं बनाना है, उन्हें हटाएँ।",
    "Sent entries are selected. Tick or untick to change the bill.": "भेजी गई Entries चुनी हैं। बिल बदलने के लिए चुनें या हटाएँ।",
    "Select": "चुनें",
    "Select all": "सभी चुनें",
    "Clear selection": "Selection Clear करें",
    "More columns": "अन्य Columns",

    // Register and Party-wise: Columns switch, Top / Newest, several entries sent in full
    "Columns": "Columns",
    "Which columns to show": "कौन से Columns दिखाएँ",
    "Main": "मुख्य",
    "All (like Excel)": "सभी (Excel जैसे)",
    "The entry and its bill: no sideways scrolling": "Entry और उसका बिल: बगल में Scroll नहीं करना पड़ता",
    "Dispatches (JAWAK) with NAG and BALANCE: no sideways scrolling": "जावक, नग और Balance: बगल में Scroll नहीं करना पड़ता",
    "Every column, as in the Excel register": "सभी Columns, Excel रजिस्टर की तरह",
    "Go to": "यहाँ जाएँ",
    "↑ Top": "↑ ऊपर",
    "↓ Newest": "↓ सबसे नई",
    "Go to the first entry": "पहली Entry पर जाएँ",
    "Go to the newest entries": "सबसे नई Entries पर जाएँ",
    "Send ticked entries in full": "Tick की गई Entries पूरी भेजें",
    "Gate pass no.": "गेट पास नं.",
    "Mark sent in full": "पूरा भेजा गया Mark करें",
    "Mark it sent in full": "इसे पूरा भेजा गया Mark करें",
    "Clear ticks": "Ticks हटाएँ",
    "1 entry ticked": "1 Entry Tick की गई",
    "still to send": "अभी भेजना बाकी",
    "Type the gate pass number first.": "पहले गेट पास नंबर लिखें।",
    "Fewer columns": "कम Columns",
    "Loading entries...": "Entries Load हो रही हैं...",
    "Making bills...": "बिल बन रहे हैं...",
    "Back to entries": "Entries पर वापस",
    "Make another bill": "अगला बिल बनाएँ",
    "Back to entries. The draft bills were not saved.": "Entries पर वापस। Draft बिल Save नहीं हुए।",
    "Bill date changed. Make the bills again before saving.": "बिल की Date बदली है। Save करने से पहले बिल दोबारा बनाएँ।",
    "No party matches. Clear the search to see all parties.": "कोई पार्टी नहीं मिली। सभी पार्टियाँ देखने के लिए Search Clear करें।",
    "Choose a party": "पार्टी चुनें",
    "Click a party with entries still to bill.": "जिस पार्टी की Entries का बिल अभी बाकी है, उस पर Click करें।",
    "Party to bill": "बिल बनाने के लिए पार्टी",
    "Type party name": "पार्टी का नाम लिखें",
    "Not billed yet": "अभी बिल नहीं बना",
    "Review entries and make bills": "Entries Check करें और बिल बनाएँ",
    "Tick the entries to include, then press Make bills.": "शामिल करने वाली Entries चुनें, फिर बिल बनाएँ दबाएँ।",
    "Choose a party to begin": "शुरू करने के लिए पार्टी चुनें",
    "Choose a party in step 2": "Step 2 में पार्टी चुनें",
    "Its discount, GSTIN, and ready-to-bill entries will appear here.": "यहाँ Discount, GSTIN और बिल के लिए तैयार Entries दिखेंगी।",
    "Check the message below, then choose the party again.": "नीचे संदेश देखें, फिर पार्टी दोबारा चुनें।",
    "Selected party": "चुनी गई पार्टी",
    "Entries in period": "Period की Entries",
    "Bills can include unsent entries": "बिल में न भेजी गई Entries शामिल हो सकती हैं",
    "No entries loaded": "कोई Entry Load नहीं हुई",
    "No entries selected": "कोई Entry Select नहीं हुई",
    "Choose a party on the left.": "बाईं ओर से एक पार्टी चुनें।",
    "Make bills from ticked entries": "चुनी गई Entries से बिल बनाएँ",
    "Tick entries to bill": "बिल के लिए Entries चुनें",
    "Save and number these bills": "इन बिलों को Save करें और नंबर दें",
    "Save and number this bill": "इस बिल को Save करें और नंबर दें",
    "Discarded — nothing was saved.": "Discard कर दिया — कुछ भी Save नहीं हुआ।",
    "Bill no., party, finish…": "बिल नं., पार्टी, फ़िनिश…",
    "Print shown bills": "दिखाए गए बिल प्रिंट करें",
    "Print these bills": "ये बिल प्रिंट करें",
    "Export to Excel…": "Excel में Export करें…",
    "Export the shown bills into a copy of the Excel bill workbook": "दिखाए गए बिल Excel बिल वर्कबुक की Copy में Export करें",
    "Export bills to Excel": "बिल Excel में Export करें",
    "Into a copy of the month's bill workbook — your file is not changed": "महीने की बिल वर्कबुक की Copy में — आपकी File नहीं बदलती",
    "1. Bills": "1. बिल",
    "2. Bill workbook": "2. बिल वर्कबुक",
    "3. Check": "3. Check",
    "Only saved bills can be written. Each goes into the place of the workbook that has its bill no.":
      "सिर्फ़ Save हुए बिल लिखे जा सकते हैं। हर बिल वर्कबुक में अपने बिल नं. वाली जगह पर जाता है।",
    "This month's MPH BILL workbook. It is read, never changed: you download a filled copy.":
      "इस महीने की MPH BILL वर्कबुक। यह सिर्फ़ पढ़ी जाती है, बदली नहीं जाती: आप भरी हुई Copy Download करते हैं।",
    "Choose the bill workbook to see where each bill goes.": "हर बिल कहाँ जाएगा, यह देखने के लिए बिल वर्कबुक चुनें।",
    "Download filled workbook": "भरी हुई वर्कबुक Download करें",
    "Check again": "फिर से Check करें",
    "Tick the bills to write.": "लिखने के लिए बिल चुनें।",
    "Tick every bill": "सभी बिल चुनें",
    "Checking the workbook…": "वर्कबुक Check हो रही है…",
    "Nothing to write yet.": "अभी लिखने को कुछ नहीं है।",
    "Writing…": "लिखा जा रहा है…",
    "Will be written": "लिखा जाएगा",
    "Will be written over": "पुराने की जगह लिखा जाएगा",
    "Already in the workbook": "वर्कबुक में पहले से है",
    "In the workbook, but different": "वर्कबुक में है, पर अलग है",
    "Cannot be written": "नहीं लिखा जा सकता",
    "Replace": "बदलें",
    "Changed since written": "लिखने के बाद बदला गया",
    "EXCEL": "Excel",
    "PLACE": "जगह",
    "RESULT": "नतीजा",
    "TYPED / DIFFERENCES": "Typed / अंतर",
    "REG. MONTH": "रजिस्टर Month",
    "BILL AS": "बिल फ़िनिश",
    "RATE": "Rate",
    "JAWAK": "जावक",
    "DISPATCH": "जावक Status",
    "GATE PASS": "गेट पास",
    "G.P.N.": "गेट पास नं.",
    "Amount(Rs.)": "Amount (₹)",
    "AMOUNT": "Amount",
    "TOTAL": "Total",
    "ENTRIES": "Entries",
    "STATUS": "Status",
    "FROM": "स्रोत",
    "Not sent": "नहीं भेजा",
    "Part sent": "Partial भेजा",
    "Sent": "भेजा गया",
    "no rate": "Rate नहीं",
    "Tick all": "सभी चुनें",
    "Total of the lines above": "ऊपर की Lines का Total",
    "+ row": "+ Row",
    "Insert an empty row below": "नीचे एक खाली Row Add करें",
    "Remove this row": "यह Row Remove करें",
    "Remove this row — its entries become unbilled again": "यह Row Remove करें — इसकी Entries फिर से बिना बिल हो जाएँगी",
    "merge ↑": "Merge ↑",
    "Combine with the row above (references and THAN are joined)": "ऊपर वाली Row के साथ Combine करें (References और थान जुड़ जाएँगे)",
    "Move…": "Move…",
    "Use Move… to send a row to another draft or start a new bill.": "Row को दूसरे Draft में भेजने या नया बिल बनाने के लिए Move… चुनें।",
    "New bill": "नया बिल",
    "You can change it. It cannot match a bill already saved.": "आप इसे बदल सकते हैं। यह पहले से Save हुए किसी बिल जैसा नहीं हो सकता।",
    "Entries for": "इनकी Entries",
    "Bill recipient updated.": "बिल की पार्टी Update हो गई।",
    "This subtotal has its own references. Clear them before moving its last detail row.": "इस Subtotal के अपने References हैं। आखिरी Detail Row को Move करने से पहले उन्हें हटाएँ।",
    "Give the remaining rows a rate or move them first before emptying this bill.": "इस बिल को खाली करने से पहले बाकी Rows को Rate दें या उन्हें Move करें।",
    "detail": "Details",
    "priced": "Rate सहित",
    "blank": "खाली",
    "Gross Total": "Gross Total",
    "Net Taxable Amount": "Net Taxable Amount",
    "Invoice Total": "बिल Total",
    "Not saved yet.": "अभी Save नहीं हुआ।",
    "Use latest party details": "पार्टी की Latest Details लें",
    "Party name, address, GSTIN and discount will be refreshed from Masters when you save.": "Save करने पर पार्टी का नाम, Address, GSTIN और Discount, Masters से Update हो जाएँगे।",
    "Cancel this bill": "यह बिल Cancel करें",
    "Cancel selected": "चुने हुए बिल Cancel करें",
    "Undo & release numbers": "Save Undo करें और नंबर वापस लें",
    "Cancel selected bills": "चुने हुए बिल Cancel करें",
    "Cancel bills": "बिल Cancel करें",
    "Keep bills": "बिल रखें",
    "Undo saves & release numbers": "Save Undo करें और नंबर वापस लें",
    "Never issued - undo saves": "बिल जारी नहीं हुए - Save Undo करें",
    "Could not cancel every selected bill": "चुने हुए सभी बिल Cancel नहीं हो सके",
    "Could not undo every selected bill": "चुने हुए सभी बिल का Save Undo नहीं हो सका",
    "Select every shown bill": "दिखाए गए सभी बिल चुनें",
    "Restore this bill": "यह बिल वापस लाएँ",
    "Restore bill": "बिल वापस लाएँ",
    "Keep cancelled": "Cancelled रहने दें",
    "The bill becomes saved again and its entries are marked billed on it.": "बिल फिर से Save हो जाएगा और इसकी Entries इसी बिल पर Billed मानी जाएँगी।",
    "Restoring puts the bill back as saved and marks its entries billed on it again.": "वापस लाने पर बिल फिर से Save हो जाता है और इसकी Entries दोबारा इसी बिल पर Billed मानी जाती हैं।",
    "Only a cancelled bill can be restored.": "सिर्फ़ Cancelled बिल को वापस लाया जा सकता है।",
    "Undo save & release number": "Save Undo करें और नंबर वापस लें",
    "Never issued - undo save": "बिल जारी नहीं हुआ - Save Undo करें",
    "This makes the entries unbilled and releases the number for the next bill. Confirm only if this bill was never issued to a customer, reported for GST, or given an IRN. Undo history is kept.":
      "इससे Entries बिना बिल की हो जाएँगी और नंबर अगले बिल के लिए वापस मिलेगा। Confirm केवल तभी करें जब बिल कभी Customer को जारी नहीं हुआ, GST में Report नहीं हुआ और कोई IRN नहीं बना। Undo की History रहेगी।",
    "Undo history is kept. Only the latest never-issued app bill can release its number.":
      "Undo की History रहेगी। केवल App के सबसे आखिरी, कभी जारी न हुए बिल का नंबर वापस मिल सकता है।",
    "Save or discard your changes before undoing this bill's save.": "इस बिल का Save Undo करने से पहले अपने बदलाव Save करें या हटा दें।",
    "Confirm that this bill was never issued to a customer, reported for GST, or given an IRN.":
      "Confirm करें कि बिल कभी Customer को जारी नहीं हुआ, GST में Report नहीं हुआ और कोई IRN नहीं बना।",
    "A cancelled bill keeps its number and cannot be undone.": "Cancelled बिल का नंबर इस्तेमाल में रहता है और उसका Save Undo नहीं हो सकता।",
    "Imported Excel bills cannot release their numbers.": "Excel से Import किए गए बिलों के नंबर वापस नहीं मिल सकते।",
    "A later bill exists in this financial year, even if it is cancelled or for another party.":
      "इस Financial Year में इसके बाद का बिल है, भले ही वह Cancelled हो या दूसरी पार्टी का हो।",
    "The next bill number has been changed. It cannot be rewound by undoing this save.":
      "अगला बिल नंबर बदला गया है। इस Save को Undo करके उसे पीछे नहीं किया जा सकता।",
    "The bill has changed. Reopen it before undoing the save.": "बिल बदल गया है। Save Undo करने से पहले उसे फिर से खोलें।",
    "Could not refresh bills": "बिलों की List Refresh नहीं हो सकी",
    "The bill's save was undone. Reopen Bills to refresh the lists.": "बिल का Save Undo हो गया। Lists Refresh करने के लिए Bills फिर से खोलें।",
    "Dates": "Dates",
    "Note (not printed)": "नोट (प्रिंट नहीं होगा)",
    "Lines": "Lines",
    "Note": "नोट",

    // Masters tabs & parties
    "Parties": "पार्टियाँ",
    "Sister firms": "Sister Firms",
    "Billing styles": "Billing Styles",
    "+ Add sister group": "+ Sister Group Add करें",
    "Add sister group": "Sister Group Add करें",
    "Add a sister-firm group": "Sister-Firm Group Add करें",
    "Parties in this group": "इस Group की पार्टियाँ",
    "Find a party…": "पार्टी खोजें…",
    "Delete group": "Group Delete करें",
    "Delete sister-firm group": "Sister-Firm Group Delete करें",
    "SISTER-FIRM GROUP": "SISTER-FIRM GROUP",
    "FIRMS": "फ़र्में",
    "A party can be in one group only; ticking one that is in another group moves it here.": "एक पार्टी सिर्फ़ एक Group में हो सकती है; किसी दूसरे Group की पार्टी पर Tick करने से वह यहाँ आ जाती है।",
    "Parties in the same sister-firm group may bill each other's entries in Excel; the bill import then links them. A party can be in one group only.": "एक ही Sister-Firm Group की पार्टियाँ Excel में एक-दूसरे की Entries का बिल बना सकती हैं; बिल Import तब उन्हें Link करता है। एक पार्टी सिर्फ़ एक Group में हो सकती है।",
    "No sister-firm groups yet. Add one to link parties that bill each other's entries.": "अभी कोई Sister-Firm Group नहीं है। एक-दूसरे की Entries का बिल बनाने वाली पार्टियों को जोड़ने के लिए Group Add करें।",
    "Finishes and groups": "फ़िनिश और Groups",
    "Colours": "Colours",
    "Firm and bill settings": "Firm और बिल Settings",
    "Party, GSTIN, address, style…": "पार्टी, GSTIN, Address, Style…",
    "Show inactive": "Inactive दिखाएँ",
    "Only with problems": "केवल समस्या वाले",
    "+ Add party": "+ पार्टी Add करें",
    "Add party": "पार्टी Add करें",
    "Add a party": "नई पार्टी Add करें",
    "Details, billing style and rates": "Details, Billing Style और Rates",
    "ACTIVE": "Active",
    "ADDRESS": "Address",
    "STATE": "State",
    "GSTIN": "GSTIN",
    "DISC %": "Discount %",
    "BILLING STYLE": "Billing Style",
    "RATES": "Rates",
    "CHECK": "Check",
    "No party matches.": "कोई पार्टी मेल नहीं खाती।",
    "Party name": "पार्टी का नाम",
    "Address": "Address",
    "State": "State",
    "Discount %": "Discount %",
    "Taken off the gross of every bill": "हर बिल के ग्रॉस में से घटाया जाता है",
    "Name colour": "नाम का Colour",
    "Sister-firm group": "Sister-Firm Group",
    "Choose any member of this group as the bill recipient. Excel bill imports also use this group to link entries.": "बिल के लिए इस Group की कोई भी पार्टी चुन सकते हैं। Excel बिल Import भी Entries Link करने के लिए इस Group का इस्तेमाल करता है।",
    "e.g. HARRISON — leave empty if none": "जैसे HARRISON — न हो तो खाली छोड़ें",
    "15 characters, e.g. 08ABCDE1234F1Z5": "15 अक्षर, जैसे 08ABCDE1234F1Z5",
    "✓ looks valid": "✓ सही प्रतीत होता है",
    "✗ not a valid GSTIN": "✗ मान्य GSTIN नहीं है",
    "Billing style": "Billing Style",
    "Bill before dispatch (tick entries not sent yet)": "जावक से पहले बिल बनाएँ (अभी न भेजी गई Entries चुनें)",
    "Bill a finish under another finish name": "किसी फ़िनिश का बिल दूसरे फ़िनिश नाम से बनाएँ",
    "Example: SGZ billed as SGJ. Leave empty when the bill uses the inward finish.": "उदाहरण: SGZ का बिल SGJ के रूप में। जब आवक फ़िनिश ही उपयोग हो तो खाली छोड़ें।",
    "— inward finish —": "— आवक फ़िनिश —",
    "— bill as —": "— बिल फ़िनिश —",
    "+ Add bill-as finish": "+ बिल-फ़िनिश जोड़ें",
    "Rates (₹ per THAN)": "Rates (₹ प्रति थान)",
    "Add the party first, then add its rates here.": "पहले पार्टी Add करें, फिर यहाँ उसके Rates Add करें।",
    "— choose finish —": "— फ़िनिश चुनें —",
    "₹ per THAN": "₹ प्रति थान",
    "GROUP": "Group",
    "RATE (₹ PER THAN)": "Rate (₹ प्रति थान)",
    "No rates yet — bills for this party need at least one.": "अभी कोई Rate नहीं — इस पार्टी के बिल के लिए कम से कम एक Rate ज़रूरी है।",
    "+ Add rate": "+ Rate Add करें",
    "Each change is saved at once": "हर बदलाव तुरंत Save हो जाता है",

    // Masters: Billing styles
    "A billing style says what each bill line shows and how entries are put on lines. Every party picks one style, so changing a style changes the bills of all its parties.":
      "Billing Style तय करती है कि हर बिल Line में क्या दिखेगा और Entries, Lines में कैसे जुड़ेंगी। हर पार्टी एक Style चुनती है, इसलिए Style बदलने से उसकी सभी पार्टियों के बिल बदल जाते हैं।",
    "+ Add billing style": "+ Billing Style Add करें",
    "Add a billing style": "नई Billing Style Add करें",
    "Save style": "Style Save करें",
    "Add style": "Style Add करें",
    "Delete style": "Style Delete करें",
    "Parties use this style; give them another style first.": "पार्टियाँ इस Style का इस्तेमाल कर रही हैं; पहले उन्हें दूसरी Style दें।",
    "Not used by any party yet": "अभी किसी पार्टी द्वारा उपयोग नहीं किया गया",
    "Style": "Style",
    "Style name": "Style का नाम",
    "What it is for (optional)": "यह किसके लिए है (Optional)",
    "When to use this style": "यह Style कब इस्तेमाल करें",
    "What each bill line shows": "हर बिल Line में क्या दिखे",
    "G.P.N. column": "G.P.N. कॉलम",
    "D.N. column": "D.N. कॉलम",
    "LOT NO. column": "LOT NO. कॉलम",
    "How entries become lines": "Entries से Lines कैसे बनें",
    "Order of lines": "Lines का Order",
    "Show THAN like (15+28) on shared lines": "Shared Lines पर थान (15+28) की तरह दिखाएँ",
    "Combine small entries (see Firm and bill settings)": "छोटी Entries Combine करें (Firm और बिल Settings देखें)",
    "Combine small entries (see Settings)": "छोटी Entries Combine करें (Settings देखें)",
    "Preview with sample entries": "Sample Entries के साथ Preview",
    "Made by the real bill maker": "असली बिल निर्माता द्वारा तैयार",
    "Parties using it": "इसका उपयोग करने वाली पार्टियाँ",
    "LINES": "Lines",
    "ORDER": "Order",
    "SMALL ENTRIES": "छोटी Entries",
    "PARTIES": "पार्टियाँ",
    "Combined": "Combined",
    "Apart": "अलग-अलग",
    "Leave empty": "खाली छोड़ें",
    "Gate pass numbers": "गेट पास नंबर",
    "Design no. (D.N.)": "डिज़ाइन नं. (D.N.)",
    "Lot no. (LOT N.)": "लॉट नं. (LOT N.)",
    "One line per inward entry": "हर आवक Entry के लिए एक Line",
    "Same lot on one line": "एक ही लॉट एक Line में",
    "Same gate pass on one line": "एक ही गेट पास एक Line में",
    "Inward order (older first)": "आवक क्रम (पुराना पहले)",
    "By the number shown (lot / D.N.)": "दिखाए गए नंबर के अनुसार (लॉट / D.N.)",
    "By inward date": "आवक Date के अनुसार",

    // Masters: Finishes, groups & colours
    "Finishes": "फ़िनिश",
    "Finish": "फ़िनिश",
    "+ Add finish": "+ फ़िनिश Add करें",
    "Add finish": "फ़िनिश Add करें",
    "Add a finish": "नया फ़िनिश Add करें",
    "Finish groups": "फ़िनिश Groups",
    "Finish group": "फ़िनिश Group",
    "+ Add group": "+ Group Add करें",
    "Add group": "Group Add करें",
    "Add a finish group": "नया फ़िनिश Group Add करें",
    "Group": "Group",
    "Group name": "Group का नाम",
    "— no group —": "— कोई Group नहीं —",
    "COLOUR": "Colour",
    "IF PARTY HAS NO RATE, BILL AS": "Rate न होने पर इस फ़िनिश से बिल करें",
    "PARTIES WITH A RATE": "Rate वाली पार्टियाँ",
    "FINISHES": "फ़िनिश",
    "Colour on bills": "बिल पर Colour",
    "If the party has no rate for it, bill as": "अगर पार्टी के पास इसका Rate नहीं है, तो इस नाम से बिल करें",
    "The first of these the party has a rate for": "इनमें से पहला जिसके लिए पार्टी के पास Rate है",
    "e.g. SGJ, SGB": "जैसे SGJ, SGB",
    "Colour names for party and finish names on bills and screens.": "बिलों और स्क्रीन पर पार्टी और फ़िनिश के नामों के लिए Colours।",
    "+ Add colour": "+ Colour Add करें",
    "Add colour": "Colour Add करें",
    "Add a colour": "नया Colour Add करें",
    "Save colour": "Colour Save करें",
    "Delete colour": "Colour Delete करें",
    "COLOUR NAME": "Colour का नाम",
    "VALUE": "Value",
    "Colour": "Colour",
    "Name (as typed for parties and finishes)": "नाम (जैसा पार्टियों और फ़िनिश के लिए लिखा जाता है)",
    "Parties or finishes use this colour.": "पार्टियाँ या फ़िनिश इस Colour का इस्तेमाल कर रहे हैं।",
    "Not used yet": "अभी उपयोग नहीं किया गया",

    // Masters: Firm & bill settings
    "Firm details": "Firm Details",
    "Printed on every bill": "हर बिल पर प्रिंट होता है",
    "Firm name": "फ़र्म का नाम",
    "Firm GSTIN": "फ़र्म GSTIN",
    "Address line 1": "Address Line 1",
    "Address line 2": "Address Line 2",
    "Phone line": "Phone Line",
    "MSME / Udyam line": "MSME / उद्यम Line",
    "Home state GST code (08 = Rajasthan)": "गृह राज्य GST कोड (08 = राजस्थान)",
    "Home state name": "गृह राज्य का नाम",
    "Bill rules": "बिल Rules",
    "Bill number prefix ({FY} = 26-27)": "बिल नंबर Prefix ({FY} = 26-27)",
    "Bill total must stay below ₹ (0 = no limit)": "बिल Total इससे कम रहे ₹ (0 = कोई Limit नहीं)",
    "no limit": "कोई Limit नहीं",
    "Rows per bill": "हर बिल में Rows",
    "Combine entries with THAN below (0 = never)": "इससे कम थान वाली Entries Combine करें (0 = कभी नहीं)",
    "Combine up to (entries per line)": "इतनी तक Combine करें (हर Line में Entries)",
    "CGST %": "CGST %",
    "SGST %": "SGST %",
    "IGST % (other states)": "IGST % (अन्य राज्य)",
    "Bill numbers": "बिल नंबर",
    "Kept in the data file": "डेटा फ़ाइल में सुरक्षित",
    "Financial year": "Financial Year",
    "Next bill number in this year": "इस Year का अगला बिल नंबर",
    "Printing": "Printing",
    "Paper": "Paper",
    "Letter (same as the Excel bill)": "Letter (एक्सेल बिल जैसा)",
    "A4": "A4",
    "Smallest font on bill lines (pt)": "बिल Lines का सबसे छोटा Font (pt)",
    "Long lot / D.N. lists shrink to this, then wrap onto a second row.": "लंबी लॉट / D.N. List यहाँ तक छोटी होती है, फिर दूसरी Row में जाती है।",
    "Amounts in lakhs style (₹1,37,757.00)": "Amount लाखों के Format में (₹1,37,757.00)",
    "Texts printed on the bill": "बिल पर प्रिंट होने वाले शब्द",
    "Top of the bill": "बिल का ऊपरी भाग",
    "Title": "Title",
    "Copy label": "कॉपी लेबल",
    "Before the firm GSTIN": "फ़र्म GSTIN से पहले",
    "Party details label": "पार्टी Details Label",
    "Invoice no. label": "इनवॉइस नं. लेबल",
    "Date label": "Date Label",
    "Before the bill period": "बिल Period से पहले",
    "Between period dates": "Period की Dates के बीच",
    "Before the party GSTIN": "पार्टी GSTIN से पहले",
    "Kind of bill": "बिल का प्रकार",
    "SAC line": "SAC Line",
    "Column headings": "Column Headings",
    "Amount": "Amount",
    "Totals": "Totals",
    "Gross": "Gross",
    "Total Rs.": "Total ₹",
    "Discount": "Discount",
    "Taxable": "Taxable",
    "CGST": "CGST",
    "SGST": "SGST",
    "IGST": "IGST",
    "Invoice total": "बिल Total",
    "Bottom of the bill": "बिल का निचला भाग",
    "Bank line 1": "Bank Line 1",
    "Bank line 2": "Bank Line 2",
    "Payment line": "Payment Line",
    "Signatory line": "Signatory Line",
    "Signature label": "Signature Label",
    "Checked-by label": "Checked-by Label",
    "Terms (one per line, up to 4)": "Terms (हर Line में एक, ज़्यादा से ज़्यादा 4)",
    "Signature": "Signature",
    "Kept in the config file": "कॉन्फ़िग फ़ाइल में सुरक्षित",
    "No signature": "कोई Signature नहीं",
    "No signature — bills print without one.": "कोई Signature नहीं — बिल बिना Signature के Print होंगे।",
    "Use this picture": "यह Picture इस्तेमाल करें",
    "Choose a PNG or JPG picture first.": "पहले PNG या JPG Picture चुनें।",
    "Signature saved": "Signature Save हो गया",
    "Remove signature": "Signature Remove करें",
    "Print bills without a signature?": "बिना Signature के बिल Print करें?",
    "Screens": "स्क्रीन",
    "Appearance": "Appearance",
    "Theme (also the switch at the top right)": "Theme (ऊपर दाईं ओर Button से भी बदलें)",
    "Language (also the switch at the top right)": "Language (ऊपर दाईं ओर Button से भी बदलें)",
    "Theme (also in the right-side menu)": "Theme (दाईं ओर के मेन्यू में भी)",
    "Language (also in the right-side menu)": "Language (दाईं ओर के मेन्यू में भी)",
    "Light": "लाइट",
    "Dark": "डार्क",
    "Show the Excel import screens": "Excel Import स्क्रीन दिखाएँ",
    "Features": "Features",
    "Show or hide screens and sections in the UI": "UI में Screens और Sections दिखाएँ या Hide करें",
    "Masters → Billing styles subsection (hidden by default)": "Masters → Billing Styles Section (Default में Hidden)",
    "Excel import": "Excel Import",
    "Import Excel tab (inward register and bills)": "Excel Import Tab (आवक रजिस्टर और बिल)",
    "Party-wise tab": "Party-wise Tab",
    "Bills tab (make and saved bills)": "बिल Tab (बिल बनाना और Saved बिल)",
    "Masters → Colours subsection": "Masters → Colours Section",
    "Dashboard": "Dashboard",
    "Dashboard tab (income, unbilled work, GST and parties)": "Dashboard Tab (आय, बिना बिल का काम, GST और पार्टियाँ)",
    "Save settings": "Settings Save करें",
    "Saved ✓ to the config file": "Config File में Save हो गया ✓",
    "Settings saved": "Settings Save हो गईं",
    "Config file": "कॉन्फ़िग फ़ाइल",
    "Read the config file again": "कॉन्फ़िग फ़ाइल फिर से पढ़ें",
    "Config file read again": "कॉन्फ़िग फ़ाइल फिर से पढ़ी गई",
    "Parties, finishes, styles, colours and every setting on this page are kept in this file, next to the data file. Changes made here are written to it at once; if it is edited outside the app, the app reads it again by itself.":
      "पार्टियाँ, फ़िनिश, Styles, Colours और इस Page की हर Setting, Data File के पास इस File में रखी जाती है। यहाँ किए गए बदलाव तुरंत Save होते हैं; अगर इसे ऐप के बाहर Edit करें, तो ऐप इसे अपने-आप दोबारा पढ़ लेता है।",

    // Import screens
    "Inward register": "आवक रजिस्टर",
    "Import an inward register workbook": "आवक रजिस्टर वर्कबुक इम्पोर्ट करें",
    "Reads the": "मासिक वर्कबुक की",
    "sheet of a monthly workbook. Your workbook is never changed. A backup of the data file is taken before anything is imported.":
      "शीट पढ़ता है। आपकी वर्कबुक कभी बदली नहीं जाती। कुछ भी इम्पोर्ट करने से पहले डेटा फ़ाइल का बैकअप लिया जाता है।",
    "Workbook (.xlsm / .xlsx)": "वर्कबुक (.xlsm / .xlsx)",
    "1. Check file": "1. File Check करें",
    "2. Import": "2. Import करें",
    "Choose a workbook first.": "पहले एक वर्कबुक चुनें।",
    "Cannot import:": "इम्पोर्ट नहीं हो सका:",
    "File": "फ़ाइल",
    "New entries": "नई Entries",
    "Carryover rows": "कैरीओवर Rows",
    "Carryovers merged into earlier months": "पिछले माहों में मिलाए गए कैरीओवर",
    "Dispatch lines": "जावक Lines",
    "Imported ✓": "Import हो गया ✓",
    "Check passed — ready to import": "Check Pass — Import के लिए तैयार",
    "Problems found — nothing imported": "Problems मिलीं — कुछ भी Import नहीं हुआ",
    "Importing a month that is already in the app updates it: new rows are added, what changed in the workbook since the last import is applied, what was changed in the app is kept, and entries no longer in the workbook are removed (never billed ones). Check file lists every new and updated entry first; after importing, the Register's Last import filters show them.":
      "जो माह ऐप में पहले से है उसे फिर से Import करने पर वह Update होता है: नई Rows जुड़ती हैं, पिछले Import के बाद Workbook में हुए बदलाव लागू होते हैं, ऐप में किए गए बदलाव रखे जाते हैं, और जो Entries अब Workbook में नहीं हैं वे हटा दी जाती हैं (बिल वाली कभी नहीं)। File Check पहले हर नई और Update होने वाली Entry दिखाता है; Import के बाद रजिस्टर के पिछला Import Filters उन्हें दिखाते हैं।",
    "Entries already saved": "पहले से Saved Entries",
    "Entries changed": "बदली गई Entries",
    "Entries unchanged": "बिना बदलाव की Entries",
    "Entries removed": "हटाई गई Entries",
    "Entries of other months changed": "दूसरे माहों की बदली गई Entries",
    "Show new entries in the Register": "नई Entries रजिस्टर में दिखाएँ",
    "Show updated entries in the Register": "Update हुई Entries रजिस्टर में दिखाएँ",
    "Updated ✓": "Update हो गया ✓",
    "Check passed — ready to update": "Check Pass — Update के लिए तैयार",
    "Nothing to update — no new changes in this workbook": "Update के लिए कुछ नहीं — इस Workbook में कोई नया बदलाव नहीं",
    "These were changed in the app (or by a later month's carryover rows) since the last import. If the workbook is right, change them in the Register.":
      "ये पिछले Import के बाद ऐप में (या बाद के माह की कैरीओवर Rows से) बदले गए थे। अगर Workbook सही है, तो इन्हें रजिस्टर में बदलें।",
    "Update the month": "माह Update करें",
    "Update and remove": "Update करें और हटाएँ",
    "Import bills from the Excel bill workbook": "एक्सेल बिल वर्कबुक से बिल इम्पोर्ट करें",
    "Reads every filled bill on the": "वर्कबुक की",
    "sheet, checks each total, and links bill lines to inward entries so they are not billed again. Your workbook is never changed.":
      "Sheet से हर भरा हुआ बिल पढ़ता है, हर Total Check करता है, और बिल Lines को आवक Entries से Link करता है ताकि उनका दोबारा बिल न बने। आपकी Workbook कभी बदली नहीं जाती।",
    "Bill workbook (.xlsm / .xlsx)": "बिल वर्कबुक (.xlsm / .xlsx)",
    "Choose the bill workbook first.": "पहले बिल वर्कबुक चुनें।",
    "Errors": "Errors",
    "Every bill, checked": "हर बिल Check किया गया",
    "LINKED": "Linked",
    "NOT LINKED": "Unlinked",
    "SHEET TOTAL": "Sheet Total",
    "APP TOTAL": "App Total",
    "✓ matches": "✓ मेल खाता है",
    "Bill lines that could not be linked to an inward entry": "बिल की वे Lines जो किसी आवक Entry से Link नहीं हो सकीं",
    "These are not linked. If the two parties are sister firms, give both the same sister-firm group in Masters → Parties, then re-check the links of imported bills.": "ये Link नहीं हुईं। अगर दोनों पार्टियाँ Sister Firms हैं, तो Masters → पार्टियाँ में दोनों को एक ही Sister-Firm Group दें, फिर Import किए बिलों के Links दोबारा Check करें।",
    "Re-check links of imported bills": "Import किए बिलों के Links दोबारा Check करें",
    "Matches every bill imported from Excel to the inward register again — after correcting the register or giving sister firms a group in Masters → Parties. The bills and their totals stay as they are; only the inward entries they are linked to change. A backup is made before saving.": "Excel से Import हर बिल को आवक रजिस्टर से दोबारा मिलाता है — रजिस्टर ठीक करने के बाद या Masters → पार्टियाँ में Sister Firms को Group देने के बाद। बिल और उनके Total वैसे ही रहते हैं; सिर्फ़ Linked आवक Entries बदलती हैं। Save से पहले Backup बनता है।",
    "1. Check links": "1. Links Check करें",
    "2. Save new links": "2. नए Links Save करें",
    "Links are up to date": "Links सही हैं",
    "Bills checked:": "Check किए बिल:",
    "Nothing is saved yet. Press Save new links to use them; a backup is made first.": "अभी कुछ Save नहीं हुआ। इन्हें लागू करने के लिए नए Links Save करें दबाएँ; पहले Backup बनता है।",
    "Their old link was a guess on THAN alone. With the new links they show as unbilled; mark them as billed if they were.": "इनका पुराना Link सिर्फ़ थान से अंदाज़ा था। नए Links में ये बिना बिल दिखेंगी; अगर बिल हुई थीं तो Mark करें।",
    "BILL PARTY": "बिल पार्टी",
    "INWARD PARTY": "आवक पार्टी",
    "ROW": "Row",
    "Mark ticked entries as already billed": "चुनी गई Entries को पहले से बिल किया Mark करें",
    "Tick the ones that were billed in Excel (for example per-lot lines). Leave the ones still to be billed — undelivered entries usually stay unticked.":
      "जो Excel में बिल हो चुके हैं (जैसे हर लॉट की Lines) उन्हें चुनें। जिनका बिल बनना बाकी है उन्हें बिना चुने छोड़ दें — न भेजी गई Entries आमतौर पर बिना चुनी रहती हैं।",
    "No bills chosen.": "कोई बिल नहीं चुना गया।",

    // Known server problems, warnings & validation messages
    "No GSTIN": "GSTIN नहीं है",
    "GSTIN is not valid": "GSTIN Valid नहीं है",
    "No discount set": "Discount Set नहीं है",
    "No rates": "कोई Rate नहीं",
    "No billing style": "कोई Billing Style नहीं",
    "Finish is missing.": "फ़िनिश खाली है।",
    "LOT N. or D.N. is marked R (repair) but REP. is No, so it will be charged.": "लॉट नं. या डिज़ाइन नं. में R (रिपेयर) लिखा है पर रिपेयर No है, इसलिए इसका बिल बनेगा।",
    "THAN + TP is 0.": "थान + टीपी 0 है।",
    "INW. NO. is blank in the register.": "रजिस्टर में आवक सं. खाली है।",
    "A priced line has no FINISH.": "Rate वाली Line में फ़िनिश नहीं है।",
    "Party has no GSTIN.": "पार्टी का GSTIN नहीं है।",
    "Party has no discount set (0% used).": "पार्टी का Discount Set नहीं है (0% लागू)।",
    "Party is marked inactive.": "पार्टी Inactive है।",
    "Party is outside the home state — IGST applies.": "पार्टी राज्य से बाहर की है — IGST लागू है।",
    "Party name is required.": "पार्टी का नाम ज़रूरी है।",
    "Discount must be between 0 and 100.": "Discount 0 से 100 के बीच होना चाहिए।",
    "Discount can have at most 2 decimals.": "Discount में ज़्यादा से ज़्यादा 2 Decimal Places हो सकते हैं।",
    "Address is too long.": "Address बहुत लंबा है।",
    "State is too long.": "State का नाम बहुत लंबा है।",
    "Choose the party.": "पार्टी चुनें।",
    "Choose a party.": "पार्टी चुनें।",
    "Choose the finish.": "फ़िनिश चुनें।",
    "Rate can have at most 2 decimals.": "Rate में ज़्यादा से ज़्यादा 2 Decimal Places हो सकते हैं।",
    "Firm name is required.": "Firm का नाम ज़रूरी है।",
    "Home state code must be 2 digits (Rajasthan is 08).": "गृह राज्य कोड 2 अंकों का होना चाहिए (राजस्थान 08 है)।",
    "A firm detail is too long.": "Firm की कोई Detail बहुत लंबी है।",
    "Bill number prefix is required (up to 40 characters).": "बिल नंबर Prefix ज़रूरी है (ज़्यादा से ज़्यादा 40 Characters)।",
    "Bill limit cannot be negative (0 means no limit).": "बिल Limit, Negative नहीं हो सकती (0 = कोई Limit नहीं)।",
    "Choose Letter or A4 paper.": "Letter या A4 Paper चुनें।",
    "A font list is too long.": "Font List बहुत लंबी है।",
    "Choose light or dark.": "लाइट या डार्क चुनें।",
    "Choose English or Hindi.": "English या हिन्दी (Hinglish) चुनें।",
    "Financial year must look like 26-27.": "Financial Year, 26-27 जैसा होना चाहिए।",
    "Next bill number must be 1 or more.": "अगला बिल नंबर 1 या अधिक होना चाहिए।",
    "Register month is missing or invalid.": "रजिस्टर Month खाली है या Valid नहीं है।",
    "Inward number must be 1 or more.": "आवक संख्या 1 या अधिक होनी चाहिए।",
    "Enter a valid date.": "Valid Date डालें।",
    "TP cannot be negative.": "टीपी Negative नहीं हो सकता।",
    "TWO PART cannot be negative.": "टू पार्ट Negative नहीं हो सकता।",
    "THAN + TP must be more than 0.": "थान + टीपी 0 से अधिक होना चाहिए।",
    "D.N. is too long.": "डिज़ाइन नं. बहुत लंबा है।",
    "Finish name is required.": "फ़िनिश का नाम ज़रूरी है।",
    "A finish cannot fall back to itself.": "फ़िनिश अपने-आप पर फ़ॉलबैक नहीं कर सकता।",
    "Group name is required.": "Group का नाम ज़रूरी है।",
    "Style name is required.": "Style का नाम ज़रूरी है।",
    "Description is too long.": "Description बहुत लंबा है।",
    "Billing style has an unknown option.": "Billing Style में अनजान Option है।",
    "Choose at least one of G.P.N., D.N. or LOT NO. to show on the bill.": "बिल पर दिखाने के लिए G.P.N., D.N. या LOT NO. में से कम से कम एक चुनें।",
    "Colour name is required.": "Colour का नाम ज़रूरी है।",
    "A colour name cannot start with #.": "Colour का नाम # से शुरू नहीं हो सकता।",
    "Pick the colour (like #1f4e79).": "Colour चुनें (जैसे #1f4e79)।",
    "Enter a valid bill date.": "बिल की Valid Date डालें।",
    "A bill needs at least one line.": "बिल में कम से कम एक Line होनी चाहिए।",
    "A bill needs at least one priced row (with FINISH and RATE).": "बिल में कम से कम एक Rate वाली Row (फ़िनिश और Rate सहित) होनी चाहिए।",
    // Aawak: goods arriving at the gate. "Aawak" itself stays in English letters: आवक already means an inward slip here.
    "New Aawak": "नया Aawak",
    "Aawak register": "Aawak रजिस्टर",
    "Aawak totals": "Aawak का जोड़",
    "Check": "जाँच",
    "Lorry walas": "लॉरी वाले",
    "LORRY WALA": "लॉरी वाला",
    "Aawak NO": "Aawak सं.",
    "INW NO": "आवक सं.",
    "NOTE": "नोट",
    "SLIPS": "Slips",
    "SLIPS NAG": "Slips नग",
    "Show": "दिखाएँ",
    "Rows": "पंक्तियाँ",
    "From": "से",
    "To": "तक",
    "Period": "समय",
    "Order": "क्रम",
    "All rows": "सभी पंक्तियाँ",
    "With warnings": "Warning वाली",
    "Linked": "जुड़ गया",
    "NAG differs": "नग अलग है",
    "Partly linked": "कुछ Slips मिलीं",
    "No inward found": "आवक Slip नहीं मिली",
    "No Aawak found": "Aawak नहीं मिला",
    "No Aawak needed": "Aawak की ज़रूरत नहीं",
    "No Aawak": "Aawak नहीं",
    "Link again": "फिर से जोड़ें",
    "Link this": "यह जोड़ें",
    "Take off": "हटाएँ",
    "Delete row": "पंक्ति Delete करें",
    "Deleted rows": "Delete की गई पंक्तियाँ",
    "Inward slips": "आवक Slips",
    "Save Aawak (Enter)": "Aawak Save करें (Enter)",
    "Group sister firms": "Sister Firms को Group में जोड़ें",
    "Print totals": "जोड़ Print करें",
    "GATE ARRIVALS / REPORT": "GATE ARRIVALS / रिपोर्ट",
    "One period. Every party, lorry wala and day's NAG, accounted for.": "एक अवधि में हर पार्टी, लॉरी वाले और दिन के नग का हिसाब।",
    "Print / Save PDF": "Print / PDF Save करें",
    "Print lorry statements": "लॉरी वालों का हिसाब Print करें",
    "Sort summaries": "जोड़ का क्रम",
    "First arrival first": "पहली Aawak पहले",
    "Total NAG": "कुल नग",
    "Aawak rows": "Aawak की पंक्तियाँ",
    "Across all arrivals": "सभी Aawak का जोड़",
    "Entries in this period": "इस अवधि की Entries",
    "Parties / groups": "पार्टियाँ / Groups",
    "Sister firms combined": "Sister Firms एक साथ",
    "Each party separately": "हर पार्टी अलग",
    "Sister firms grouped": "Sister Firms Group में",
    "Individual parties": "अलग-अलग पार्टियाँ",
    "Try again": "फिर कोशिश करें",
    "By party / group": "पार्टी / Group के हिसाब से",
    "By party": "पार्टी के हिसाब से",
    "By lorry wala": "लॉरी वाले के हिसाब से",
    "Share of period NAG. Search also finds a sister firm's name.": "अवधि के नग में हिस्सा। Sister Firm के नाम से भी Search करें।",
    "Share of period NAG. Each party is shown separately.": "अवधि के नग में हिस्सा। हर पार्टी अलग दिखाई गई है।",
    "Who brought the goods, and how much.": "कौन कितना माल लाया।",
    "Find a name...": "नाम Search करें...",
    "Search party / group totals": "पार्टी / Group के जोड़ में Search करें",
    "Search party totals": "पार्टी के जोड़ में Search करें",
    "Search lorry wala totals": "लॉरी वाले के जोड़ में Search करें",
    "Share": "हिस्सा",
    "Period total": "अवधि का कुल जोड़",
    "Daily breakdown": "हर दिन का जोड़",
    "Arrival dates in calendar order.": "Aawak की Dates के क्रम में।",
    "Lorry wala × party": "लॉरी वाला × पार्टी",
    "View NAG cross-check": "नग का Cross-check देखें",
    "Each cell is NAG for one lorry wala and party. A dash means no arrivals. Row and column totals reconcile to the period total.": "हर Cell में एक लॉरी वाले और पार्टी के नग हैं। डैश का मतलब कोई Aawak नहीं। Rows और Columns का जोड़ अवधि के कुल जोड़ से मिलता है।",
    "Rows = Aawak entries, not inward slips. Searches only hide summary lines; period totals and the printed report always include all names.": "Rows = Aawak Entries, आवक Slips नहीं। Search सिर्फ़ जोड़ की पंक्तियाँ छिपाता है; अवधि के कुल जोड़ और Print में सभी नाम रहते हैं।",
    "No matching names. Try a different search.": "कोई नाम Match नहीं हुआ। दूसरा नाम Search करें।",
    "Choose both dates to see your totals.": "जोड़ देखने के लिए दोनों Dates चुनें।",
    "The From date must be on or before the To date.": "शुरू की Date, आखिरी Date से आगे नहीं हो सकती।",
    "Check the report dates above.": "ऊपर रिपोर्ट की Dates Check करें।",
    "Updating totals...": "जोड़ Update हो रहा है...",
    "Loading your report...": "रिपोर्ट खुल रही है...",
    "The report could not be loaded. Your data has not been changed.": "रिपोर्ट नहीं खुली। आपके Data में कोई बदलाव नहीं हुआ है।",
    "No arrivals in this period": "इस अवधि में कोई Aawak नहीं",
    "Try another period or widen the dates. Totals appear here once Aawak entries are available.": "दूसरी अवधि या ज़्यादा Dates चुनें। Aawak Entries होने पर यहाँ जोड़ दिखेगा।",
    "Print lorry-wala statements": "लॉरी वालों का हिसाब Print करें",
    "Most NAG first": "सबसे ज़्यादा नग पहले",
    "This month": "इस महीने",
    "Last month": "पिछले महीने",
    "This financial year": "इस Financial Year",
    "Choose dates": "Dates चुनें",
    "Grand Total": "कुल जोड़",
    "Import an Aawak workbook": "Aawak Workbook Import करें",
    "+ Add lorry wala": "+ लॉरी वाला जोड़ें",
    "Other spellings": "दूसरी Spellings",
    "Merge": "मिलाएँ",
  };

  const FOLDER_SOURCE_HI = {
    "next to the app": "ऐप के पास",
    "in Documents": "Documents में",
    "set by MPH_DATA_DIR": "MPH_DATA_DIR द्वारा सेट",
  };

  function trStyleSummary(text) {
    // Only translate generated style summaries (not custom free-text style descriptions from config).
    if (/^(G\.P\.N\.|D\.N\.|LOT)/.test(text) && !text.includes("column:")) {
      return text
        .split(" · ")
        .map((part) => {
          if (part === "same lot on one line") return "एक ही लॉट एक Line में";
          if (part === "same gate pass on one line") return "एक ही गेट पास एक Line में";
          if (part === "sorted by number") return "नंबर के अनुसार क्रम";
          if (part === "by inward date") return "आवक Date के अनुसार";
          if (part === "small entries apart") return "छोटी Entries अलग";
          return part.replace(/=gate pass\b/g, "=गेट पास").replace(/=lot\b/g, "=लॉट");
        })
        .join(" · ");
    }
    return text;
  }

  function trProblemItem(item) {
    if (EXACT[item]) return EXACT[item];
    let m = /^Billing style "(.+)" not found$/.exec(item);
    if (m) return `Billing Style "${m[1]}" नहीं मिली`;
    m = /^Bill-to party "(.+)" not found$/.exec(item);
    if (m) return `बिल-टू पार्टी "${m[1]}" नहीं मिली`;
    m = /^Colour "(.+)" not in the colour list$/.exec(item);
    if (m) return `Colour "${m[1]}" Colour List में नहीं है`;
    return item;
  }

  function trProblemList(str) {
    return str.split(", ").map(trProblemItem).join(", ");
  }

  const PATTERNS = [
    // Table headers with numbers
    [/^JAWAK NAG (\d+)$/, (_, n) => `जावक नग ${n}`],
    [/^GATE PASS NO (\d+)$/, (_, n) => `गेट पास नं. ${n}`],
    [/^DATE (\d+)$/, (_, n) => `Date ${n}`],
    [/^([\d,]+) entries ticked$/, (_, n) => `${n} Entries Tick की गईं`],
    [/^([\d,]+) NAG$/, (_, n) => `${n} नग`],
    [/^Mark all ([\d,]+) sent in full$/, (_, n) => `सभी ${n} को पूरा भेजा गया Mark करें`],
    [/^Press Enter to send all ([\d,]+)$/, (_, n) => `सभी ${n} भेजने के लिए Enter दबाएँ`],
    [/^Saved ✓ (1 entry|[\d,]+ entries) sent in full: INW\. NO\. (.+) · gate pass (.+) · (.+)$/,
      (_, count, numbers, gatePass, date) => `Save हो गया ✓ ${count.replace(/ entry$/, " Entry").replace(/ entries$/, " Entries")} पूरी भेजी गईं: आवक सं. ${numbers} · गेट पास ${gatePass} · ${date}`],
    [/^Already billed: INW\. NO\. (.+)\. Changing an entry does not change its bill\.$/,
      (_, numbers) => `पहले से बिल बन चुका है: आवक सं. ${numbers}। Entry बदलने से उसका बिल नहीं बदलता।`],
    [/^Not saved for INW\. NO\. (\d+): (.+)$/, (_, n, message) => `आवक सं. ${n} Save नहीं हुई: ${translateCore(message)}`],

    // Row filter states and options
    [/^(.+) filter options$/, (_, label) => `${translateCore(label)} के Filter Options`],
    [/^(.+): (Any|Include|Exclude)$/, (_, label, mode) => `${translateCore(label)}: ${EXACT[mode]}`],
    [/^Excluding: (.+)$/, (_, labels) => `छिपाई गई Rows: ${labels.split(", ").map(translateCore).join(", ")}`],
    [/^(.+)\. Click to include\.$/, (_, tip) => `${translateCore(tip)}। शामिल करने के लिए Click करें।`],
    [/^(.+)\. Click to clear this filter\.$/, (_, tip) => `${translateCore(tip)}। यह Filter हटाने के लिए Click करें।`],

    // Entry form title & messages
    [/^New inward entry — (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) register$/, (_, m, y) => `नई आवक Entry — ${m} ${y} रजिस्टर`],
    [/^Correcting INW\. NO\. (\d+) — (.+) \((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) register(, carryover)?\)$/,
      (_, no, party, m, y, carry) => `आवक सं. ${no} की Correction — ${party} (${m} ${y} रजिस्टर${carry ? ", कैरीओवर" : ""})`],
    [/^(Saved|Corrected) ✓ INW\. NO\. (\d+) — (.+), all zero \(slip number only\)$/, (_, act, no, party) => `${act === "Corrected" ? "Correction हो गई" : "Save हो गया"} ✓ आवक सं. ${no} — ${party}, सब ज़ीरो (सिर्फ़ Slip नंबर)`],
    [/^(Saved|Corrected) ✓ INW\. NO\. (\d+) — (.+), ([\d,]+) THAN (.*)$/, (_, act, no, party, than, fin) => `${act === "Corrected" ? "Correction हो गई" : "Save हो गया"} ✓ आवक सं. ${no} — ${party}, ${than} थान ${fin}`],
    [/^(Deleted|Restored) ✓ INW\. NO\. (\d+) — (.+) \((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) register\)$/,
      (_, act, no, party, m, y) => `${act === "Deleted" ? "Delete हो गई" : "वापस आ गई"} ✓ आवक सं. ${no} — ${party} (${m} ${y} रजिस्टर)`],
    [/^INW\. NO\. (\d+) — (.+) \((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) register\)$/,
      (_, no, party, m, y) => `आवक सं. ${no} — ${party} (${m} ${y} रजिस्टर)`],
    [/^· (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) register$/, (_, m, y) => `· ${m} ${y} रजिस्टर`],
    [/^All ([\d,]+) deleted entries will be removed for good and cannot be restored\.$/, (_, n) => `सभी ${n} Delete की गई Entries हमेशा के लिए हट जाएँगी और वापस नहीं लाई जा सकेंगी।`],
    [/^Permanently deleted ([\d,]+) (?:entry|entries) ✓$/, (_, n) => `${n} Entries हमेशा के लिए Delete हो गईं ✓`],
    [/^(\d+) months selected$/, (_, n) => `${n} Month चुने गए`],
    [/^(\d+) deleted$/, (_, n) => `${n} Delete की गईं`],
    [/^([\d,]+) dispatch(?:es)?$/, (_, n) => `${n} जावक`],
    [/^Check first: (.+)$/, (_, x) => `पहले Check करें: ${x}`],
    [/^was "(.+)" — enter the correct date$/, (_, txt) => `पहले "${txt}" था — सही Date डालें`],
    [/^Original text: (.+)$/, (_, txt) => `Original Text: ${txt}`],
    [/^Already billed \((.+)\)\. Changing this entry does not change that bill\.$/, (_, b) => `पहले से बिल बन चुका है (${translateCore(b)})। इस Entry में बदलाव से वह बिल नहीं बदलेगा।`],
    [/^Billed outside app: (.+)$/, (_, note) => `ऐप के बाहर बिल किया गया: ${note}`],
    [/^Clearing JAWAK NAG removes dispatch (\d+) \(([\d,]+) JAWAK NAG, gate pass (.+)\)\.$/, (_, n, qty, gp) => `जावक नग खाली करने से जावक ${n} हट जाएगी (${qty} जावक नग, गेट पास ${gp === "blank" ? "खाली" : gp})।`],

    // Counts
    [/^([\d,]+) of ([\d,]+) entries$/, (_, a, b) => `${b} में से ${a} Entries`],
    [/^([\d,]+) of ([\d,]+) entries for (.+)$/, (_, a, b, p) => `${p} के लिए ${b} में से ${a} Entries`],
    [/^([\d,]+) entries for (.+)$/, (_, a, p) => `${p} के लिए ${a} Entries`],
    [/^([\d,]+) entries$/, (_, a) => `${a} Entries`],
    [/^([\d,]+) of ([\d,]+) parties$/, (_, a, b) => `${b} में से ${a} पार्टियाँ`],
    [/^([\d,]+) of ([\d,]+) finishes$/, (_, a, b) => `${b} में से ${a} फ़िनिश`],
    [/^([\d,]+) groups$/, (_, a) => `${a} Groups`],
    [/^([\d,]+) selected$/, (_, a) => `${a} चुनी गईं`],
    [/^([\d,]+) parties$/, (_, a) => `${a} पार्टियाँ`],
    [/^now in (.+)$/, (_, g) => `अभी ${g} में`],
    [/^Delete the sister-firm group "(.+)"\?$/, (_, g) => `Sister-Firm Group "${g}" Delete करें?`],
    [/^([\d,]+) parties stay as they are, but are no longer linked as sister firms\. Re-check the links of imported bills afterwards\.$/,
      (_, n) => `${n} पार्टियाँ जैसी हैं वैसी रहेंगी, पर Sister Firms के रूप में Link नहीं रहेंगी। बाद में Import किए गए बिलों के Links दोबारा जाँचें।`],
    [/^([\d,]+) styles$/, (_, a) => `${a} Styles`],
    [/^([\d,]+) colours$/, (_, a) => `${a} Colours`],
    [/^([\d,]+) bills$/, (_, a) => `${a} बिल`],
    [/^\(([\d,]+) parties\)$/, (_, a) => `(${a} पार्टियाँ)`],
    [/^([\d,]+) inward entries$/, (_, a) => `${a} आवक Entries`],
    [/^([\d,]+) inward entries · ([\d,]+) parties with a rate$/, (_, a, b) => `${a} आवक Entries · ${b} पार्टियों में Rate`],
    [/^([\d,]+) finishes$/, (_, a) => `${a} फ़िनिश`],

    // Bills — Make & Drafts & Saved
    [/^([\d,]+) of ([\d,]+) entries selected$/, (_, n, all) => `${all} में से ${n} Entries चुनी गईं`],
    [/^([\d,]+) entries to bill$/, (_, n) => `${n} Entries का बिल बाकी है`],
    [/^([\d,]+) entries · ([\d,]+) not sent$/, (_, n, unsent) => `${n} Entries · ${unsent} नहीं भेजीं`],
    [/^([\d,]+) THAN$/, (_, n) => `${n} थान`],
    [/^Select inward entry (\d+)$/, (_, n) => `आवक Entry ${n} चुनें`],
    [/^Bill as (.+)$/, (_, finish) => `बिल फ़िनिश ${finish}`],
    [/^([\d,]+) entries · ([\d,]+) THAN(?: · ([\d,]+) not sent)?$/, (_, e, t, ns) => `${e} Entries · ${t} थान${ns ? ` · ${ns} नहीं भेजे` : ""}`],
    [/^Nothing left to bill with an inward date from (.+) to (.+)\.$/, (_, a, b) => `${a} से ${b} के बीच आवक Date वाली कोई Entry बिल के लिए बाकी नहीं है।`],
    [/^Nothing left to bill for this party with an inward date from (.+) to (.+)\. Move "Period from" back to see older entries\.$/,
      (_, a, b) => `${a} से ${b} के बीच इस पार्टी के लिए बिल बनाने की कोई Entry बाकी नहीं है। पुरानी Entries देखने के लिए "Period से" पीछे करें।`],
    [/^(.+) \(inactive\)$/, (_, p) => `${p} (Inactive)`],
    [/^Could not load totals: (.+)$/, (_, err) => `जोड़ नहीं खुला: ${err}`],
    [/^Could not load (.+)$/, (_, p) => `${p} Load नहीं हो सका`],
    [/^Also includes (.+)$/, (_, p) => `${p} भी शामिल हैं`],
    [/^([\d,]+) entr(?:y has|ies have) not been dispatched yet\.$/, (_, n) => `${n} Entries की अभी जावक नहीं हुई है।`],
    [/^Check in Masters → Parties: (.+)$/, (_, probs) => `Masters → पार्टियाँ में Check करें: ${trProblemList(probs)}`],
    [/^Check before billing: (.+)\. Fix in Masters → Parties\.$/, (_, probs) => `बिल बनाने से पहले Check करें: ${trProblemList(probs)}। Masters → पार्टियाँ में ठीक करें।`],
    [/^([\d,]+) selected · ([\d,]+) THAN$/, (_, n, t) => `${n} चुनी गई · ${t} थान`],
    [/^Make ([\d,]+) bills?$/, (_, n) => `${n} बिल बनाएँ`],
    [/^Make bills: ([\d,]+) entries \(([\d,]+) THAN\)$/, (_, n, t) => `बिल बनाएँ: ${n} Entries (${t} थान)`],
    [/^Make bills from ([\d,]+) ticked entries \(([\d,]+) THAN\)$/, (_, n, t) => `${n} चुनी गई Entries से बिल बनाएँ (${t} थान)`],
    [/^([\d,]+) selected entr(?:y has|ies have) not been dispatched yet\.$/, (_, n) => `${n} चुनी गई Entries की अभी जावक नहीं हुई है।`],
    [/^([\d,]+) bill\(s\) ready to check\. Nothing is saved until you press Save\.$/, (_, n) => `${n} बिल Check के लिए तैयार। Save दबाने तक कुछ Save नहीं होगा।`],
    [/^Bill (\d+) of (\d+) — (.+) — (.+)$/, (_, i, n, p, amt) => `बिल ${i} / ${n} — ${p} — ${amt}`],
    [/^Move row (\d+) from Bill (\d+)$/, (_, row, bill) => `बिल ${bill} से Row ${row} Move करें`],
    [/^Row moved to Bill (\d+)\.$/, (_, n) => `Row बिल ${n} में Move हो गई।`],
    [/^Bill recipient for Bill (\d+)$/, (_, n) => `बिल ${n} की पार्टी`],
    [/^Bill (\d+) is full \((\d+) printed rows\)\. The row was not moved\.$/, (_, n, m) => `बिल ${n} भरा हुआ है (${m} Print Rows)। Row Move नहीं हुई।`],
    [/^Row moved to Bill (\d+)\. The empty draft was removed\.$/, (_, n) => `Row बिल ${n} में Move हो गई। खाली Draft हटा दिया गया।`],
    [/^Save and number these (\d+) bills$/, (_, n) => `इन ${n} बिलों को Save करें और नंबर दें`],
    [/^Saved (\d+) bill\(s\)$/, (_, n) => `${n} बिल Save हो गए`],
    [/^(.+) — (.+) — ([\d,]+) THAN — (₹.+)$/, (_, no, p, t, amt) => `${no} — ${p} — ${t} थान — ${amt}`],
    [/^Less\/Discount \(([\d.,]+)%\)$/, (_, pct) => `Discount (${pct}%)`],
    [/^(CGST|SGST|IGST) ([\d.,]+)%$/, (_, tax, pct) => `${tax} ${pct}%`],
    [/^([\d,]+) THAN · ([\d,]+) lines · ([\d,]+) of ([\d,]+) printed rows(?: · limit (₹.+))?$/, (_, t, l, u, m, lim) => `${t} थान · ${l} Lines · ${m} में से ${u} Print Rows${lim ? ` · Limit ${lim}` : ""}`],
    [/^The lot \/ D\.N\. text is long: this line prints on (\d+) rows in a smaller font\.$/, (_, r) => `लॉट / डिज़ाइन नं. लंबा है: यह Line छोटे Font में ${r} Rows पर Print होगी।`],
    [/^(.+) — (.+) — CANCELLED$/, (_, no, p) => `${no} — ${p} — CANCELLED`],
    [/^(.*) · GSTIN (.+?)( · imported from Excel)?$/, (_, addr, gst, xl) => `${addr} · GSTIN ${gst === "none" ? "नहीं" : gst}${xl ? " · एक्सेल से इम्पोर्ट" : ""}`],
    [/^Cancel bill (.+)\?$/, (_, no) => `बिल ${no} Cancel करें?`],
    [/^Cancel bill (.+)\?\nThe number stays used and the bill is marked CANCELLED\. Its entries become unbilled so they can be billed again\.$/,
      (_, no) => `बिल ${no} Cancel करें?\n${EXACT["The number stays used and the bill is marked CANCELLED. Its entries become unbilled so they can be billed again."]}`],
    // Bill import & inward import
    [/^Imported ✓ ([\d,]+) bills$/, (_, n) => `Import हो गया ✓ ${n} बिल`],
    [/^Saved ✓ new links for ([\d,]+) bills$/, (_, n) => `Save हो गया ✓ ${n} बिलों के नए Links`],
    [/^([\d,]+) of ([\d,]+) bills get new links$/, (_, n, t) => `${t} में से ${n} बिलों को नए Links मिलेंगे`],
    [/^Notes \(([\d,]+)\)$/, (_, n) => `Notes (${n})`],
    [/^Bill lines that match another party's inward entries \(([\d,]+)\)$/, (_, n) => `बिल की Lines जो दूसरी पार्टी की आवक Entries से मिलती हैं (${n})`],
    [/^Entries that were linked before but no bill line points at now \(([\d,]+)\)$/, (_, n) => `वे Entries जो पहले Linked थीं पर अब कोई बिल Line उनकी ओर नहीं (${n})`],
    [/^Same group: (.+)$/, (_, names) => `इसी Group में: ${names}`],
    [/^Check passed — ([\d,]+) bills ready to import$/, (_, n) => `Check Pass — ${n} बिल Import के लिए तैयार`],
    [/^Nothing new — all ([\d,]+) bills are already in the app$/, (_, n) => `कुछ नया नहीं — सभी ${n} बिल पहले से App में हैं`],
    [/^Written (\d\d\.\d\d\.\d\d)$/, (_, d) => `${d} को लिखा`],
    [/^([\d,]+) bill\(s\) will be written\. Nothing is saved until you download the filled workbook\.$/,
      (_, n) => `${n} बिल लिखे जाएँगे। भरी हुई वर्कबुक Download करने तक कुछ Save नहीं होता।`],
    [/^Downloaded (.+) with ([\d,]+) bill\(s\) written\. Open it in Excel and check it, then replace your workbook with it \(keep the old one until you have checked\)\.$/,
      (_, f, n) => `${f} Download हुई, ${n} बिल लिखे गए। इसे Excel में खोलकर Check करें, फिर अपनी वर्कबुक की जगह इसे रखें (Check होने तक पुरानी रखें)।`],
    [/^New parties \(added as inactive with the workbook's details\): (.+)$/, (_, p) => `नई पार्टियाँ (Workbook की Details के साथ Inactive Add हुईं): ${p}`],
    [/^Inward entries of these parties that no bill line was linked to \(([\d,]+)\)$/, (_, n) => `इन पार्टियों की आवक Entries जो किसी बिल Line से Link नहीं हुईं (${n})`],
    [/^Marked ([\d,]+) ✓$/, (_, n) => `${n} Mark हो गईं ✓`],
    [/^Marked ([\d,]+) (?:entry|entries) as already billed$/, (_, n) => `${n} Entries को पहले से Billed Mark किया गया`],
    [/^Imported ([\d,]+) bills$/, (_, n) => `${n} बिल Import हो गए`],
    [/^Imported ([\d,]+) entries into (.+)$/, (_, n, m) => `${m} में ${n} Entries Import हो गईं`],
    [/^Updated (.+): ([\d,]+) new, ([\d,]+) changed, ([\d,]+) removed$/, (_, m, a, b, c) => `${m} Update हो गया: ${a} नई, ${b} बदली, ${c} हटाई गईं`],
    [/^Problems found in the workbook \(([\d,]+)\): nothing imported$/, (_, n) => `Workbook में Problems मिलीं (${n}): कुछ भी Import नहीं हुआ`],
    [/^Problems found in the bill workbook \(([\d,]+)\): nothing imported$/, (_, n) => `बिल Workbook में Problems मिलीं (${n}): कुछ भी Import नहीं हुआ`],
    [/^(.+) is up to date: no new changes in this workbook$/, (_, m) => `${m} Update है: इस Workbook में कोई नया बदलाव नहीं`],
    [/^Check passed: ready to (import|update) (.+)$/, (_, v, m) => `Check Pass: ${m} ${v === "import" ? "Import" : "Update"} के लिए तैयार`],
    [/^Check passed: ([\d,]+) bills ready to import$/, (_, n) => `Check Pass: ${n} बिल Import के लिए तैयार`],
    [/^Cannot import: (.+?)(?: \(and ([\d,]+) more\))?$/, (_, e, n) => `इम्पोर्ट नहीं हो सका: ${translateCore(e)}${n ? ` (और ${n})` : ""}`],
    [/^Saved new links for ([\d,]+) bills$/, (_, n) => `${n} बिलों के नए Links Save हो गए`],
    [/^Could not (save|check) the links: (.+)$/, (_, v, e) => `Links ${v === "save" ? "Save" : "Check"} नहीं हो सके: ${translateCore(e)}`],
    [/^Excel row (\d+): (.+)$/, (_, r, msg) => `Excel Row ${r}: ${translateCore(msg)}`],
    [/^Errors \((\d+)\)$/, (_, n) => `Errors (${n})`],
    [/^Warnings — imported as-is, flagged in the Register \((\d+)\)$/, (_, n) => `Warnings — जैसी हैं वैसी Import हुईं, रजिस्टर में Mark की गईं (${n})`],
    [/^Changes from the workbook \((\d+)\)$/, (_, n) => `Workbook से बदलाव (${n})`],
    [/^New entries \(([\d,]+)\)$/, (_, n) => `नई Entries (${n})`],
    [/^Updated entries \(([\d,]+)\)$/, (_, n) => `Update हुई Entries (${n})`],
    [/^Added by the import of (.+) on (.+)$/, (_, file, when) => `${file} के Import से ${when} को जुड़ी`],
    [/^Updated by the import of (.+?) \(((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4})\) on (\S+ \S+)(?:: (.+))?$/,
      (_, file, month, when, changes) => `${file} (${month}) के Import से ${when} को Update हुई${changes ? `: ${changes}` : ""}`],
    [/^Kept as in the app \((\d+)\)$/, (_, n) => `ऐप जैसा ही रखा गया (${n})`],
    [/^Not in the workbook \((\d+)\)$/, (_, n) => `Workbook में नहीं (${n})`],
    [/^INW\. NO\. (\d+) of (\d{4}-\d{2}-\d{2}) \((.+)\) (will be removed|was removed|was entered in the app; it stays)\.$/,
      (_, no, date, party, what) => `आवक सं. ${no}, ${date} (${party}) ${{ "will be removed": "हटाई जाएगी", "was removed": "हटा दी गई", "was entered in the app; it stays": "ऐप में दर्ज की गई थी; यह रहेगी" }[what]}।`],
    [/^Update ((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4})\?$/, (_, month) => `${month} Update करें?`],
    [/^([\d,]+) saved (?:entry is|entries are) not in this workbook and will be removed\. A backup of the data file is taken first\.$/,
      (_, n) => `${n} Saved Entries इस Workbook में नहीं हैं और हटा दी जाएँगी। पहले Data File का Backup लिया जाता है।`],

    // Masters forms, rates, styles, settings
    [/^Rates \(₹ per THAN\) — ([\d,]+) finish(?:es)?$/, (_, n) => `Rates (₹ प्रति थान) — ${n} फ़िनिश`],
    [/^Saved the (.+) rate ✓$/, (_, f) => `${f} का Rate Save हो गया ✓`],
    [/^Deleted the (.+) rate ✓$/, (_, f) => `${f} का Rate Delete हो गया ✓`],
    [/^Delete the (.+) rate \((.+)\) of (.+)\?$/, (_, f, r, p) => `${p} का ${f} Rate (${r}) Delete करें?`],
    [/^Rename "(.+)" to "(.+)"\?$/, (_, a, b) => `"${a}" का नाम बदलकर "${b}" करें?`],
    [/^Its ([\d,]+) inward entries move to the new name\. Saved bills keep the name they were printed with\.$/,
      (_, n) => `इसकी ${n} आवक Entries नए नाम पर चली जाएँगी। Saved बिलों पर Print किया गया नाम ही रहेगा।`],
    [/^Rename "(.+)" to "(.+)"\?\nIts ([\d,]+) inward entries move to the new name\. Saved bills keep the name they were printed with\.$/,
      (_, a, b, n) => `"${a}" का नाम बदलकर "${b}" करें?\nइसकी ${n} आवक Entries नए नाम पर चली जाएँगी। Saved बिलों पर Print किया गया नाम ही रहेगा।`],
    [/^Rename finish "(.+)" to "(.+)"\?$/, (_, a, b) => `फ़िनिश "${a}" का नाम बदलकर "${b}" करें?`],
    [/^Its ([\d,]+) inward entries and all rates move to the new name\.$/,
      (_, n) => `इसकी ${n} आवक Entries और सभी Rates नए नाम पर चले जाएँगे।`],
    [/^Rename finish "(.+)" to "(.+)"\?\nIts ([\d,]+) inward entries and all rates move to the new name\.$/,
      (_, a, b, n) => `फ़िनिश "${a}" का नाम बदलकर "${b}" करें?\nइसकी ${n} आवक Entries और सभी Rates नए नाम पर चले जाएँगे।`],
    [/^Used by ([\d,]+) part(?:y|ies)$/, (_, n) => `${n} पार्टियों द्वारा उपयोग`],
    [/^Delete billing style "(.+)"\?$/, (_, n) => `Billing Style "${n}" Delete करें?`],
    [/^Delete colour "(.+)"\?$/, (_, n) => `Colour "${n}" Delete करें?`],
    [/^Saved ✓ (.+) — the bills of ([\d,]+) part(?:y|ies) follow it$/, (_, s, n) => `Save हो गया ✓ ${s} — ${n} पार्टियों के बिल इसके अनुसार बनेंगे`],
    [/^(.+) and ([\d,]+) more$/, (_, list, n) => `${list} और ${n} अन्य`],
    [/^Used by ([\d,]+) parties and ([\d,]+) finishes; renaming moves them$/, (_, p, f) => `${p} पार्टियों और ${f} फ़िनिश द्वारा उपयोग; नाम बदलने पर वे भी बदल जाएँगे`],
    [/^(.+) \(not found\)$/, (_, x) => `${x} (नहीं मिला)`],
    [/^(.+) \(not in the colour list\)$/, (_, x) => `${x} (Colour List में नहीं)`],
    [/^The printed bill has (\d+)\. Up to (\d+) fit on Letter, (\d+) on A4 \(smallest font ([\d.]+) pt\); more rows are drawn shorter\.$/,
      (_, t, l, a, pt) => `Print बिल में ${t} Rows हैं। Letter पर ज़्यादा से ज़्यादा ${l}, A4 पर ${a} Rows आती हैं (सबसे छोटा Font ${pt} pt); ज़्यादा Rows को छोटा किया जाता है।`],
    [/^If (.+) is missing, use$/, (_, font) => `यदि ${font} न मिले, तो उपयोग करें`],
    [/^Read: (.+) · Last saved by the app: (.+)$/, (_, r, s) => `पढ़ा गया: ${r} · ऐप ने आख़िरी बार Save किया: ${s}`],

    // Status bar & fatal/API errors
    [/^Version (.+) · ([\d,]+) entries · Data folder \((.+)\): (.+) · data file mph-data\.db \+ config file mph-config\.json$/,
      (_, v, e, src, dir) => `Version ${v} · ${e} Entries · Data Folder (${FOLDER_SOURCE_HI[src] || src}): ${dir} · Data File mph-data.db + Config File mph-config.json`],
    [/^Could not save the dark mode choice: (.+)$/, (_, err) => `Dark Mode की Choice Save नहीं हो सकी: ${translateCore(err)}`],
    [/^Could not save the language choice: (.+)$/, (_, err) => `Language की Choice Save नहीं हो सकी: ${translateCore(err)}`],
    [/^Could not reach the app: (.+)\. Close and reopen MPH Register\.$/, (_, err) => `ऐप से Connect नहीं हो सका: ${translateCore(err)}। MPH Register बंद करके फिर से खोलें।`],

    // New versions
    [/^Version (\S+) is available\. You have (\S+)\.$/, (_, l, c) => `Version ${l} आ गया है। आपके पास ${c} है।`],
    [/^Version (\S+) is the newest\.$/, (_, v) => `Version ${v} सबसे नया है।`],
    [/^Version (\S+) is already the newest\.$/, (_, v) => `Version ${v} पहले से सबसे नया है।`],
    [/^New version (\S+) is ready$/, (_, v) => `नया Version ${v} तैयार है`],
    [/^What's new in version (\S+)$/, (_, v) => `Version ${v} में क्या नया है`],
    [/^Update to version (\S+)\?$/, (_, v) => `Version ${v} पर Update करें?`],
    [/^Updated to version (\S+) ✓$/, (_, v) => `Version ${v} पर Update हो गया ✓`],
    [/^GitHub did not answer \((\d+)\)\. Try again later\.$/, (_, s) => `GitHub से जवाब नहीं मिला (${s})। बाद में फिर कोशिश करें।`],
    [/^Could not save the new version next to the app: (.+)$/, (_, err) => `नया Version App के पास Save नहीं हो सका: ${err}`],
    [/^Could not start the new version: (.+)$/, (_, err) => `नया Version शुरू नहीं हो सका: ${err}`],
    [/^Could not update: (.+)$/, (_, err) => `Update नहीं हो सका: ${translateCore(err)}`],
    [/^Version (\S+) is available\. You went back from it\.$/, (_, v) => `Version ${v} आ गया है। आप इससे वापस आए थे।`],
    [/^Go back to version (\S+)$/, (_, v) => `Version ${v} पर वापस जाएँ`],
    [/^Go back to version (\S+)\?$/, (_, v) => `Version ${v} पर वापस जाएँ?`],
    [/^This version stores the data in a newer way that the older version cannot read\. Going back puts your entries, bills and settings back to how they were at the update \((.*)\): everything changed since then is undone\.$/,
      (_, when) => `यह Version Data को नए तरीके से रखता है, जिसे पुराना Version नहीं पढ़ सकता। वापस जाने पर आपकी Entries, बिल और Settings वैसे हो जाएँगे जैसे Update के समय (${when}) थे: उसके बाद के सभी बदलाव हट जाएँगे।`],
    [/^Went back to version (\S+) ✓$/, (_, v) => `Version ${v} पर वापस आ गए ✓`],
    [/^Could not go back, so this is still version (\S+)\.$/, (_, v) => `वापस नहीं जा सके, इसलिए यह अभी भी Version ${v} है।`],
    [/^Could not go back: (.+)$/, (_, err) => `वापस नहीं जा सके: ${translateCore(err)}`],
    [/^Could not get the older version ready: (.+)$/, (_, err) => `पुराना Version तैयार नहीं हो सका: ${err}`],
    [/^Could not start going back: (.+)$/, (_, err) => `वापस जाना शुरू नहीं हो सका: ${err}`],
    [/^Request failed \((\d+)\)\.$/, (_, s) => `Request Fail हो गई (${s})।`],
    [/^PDF failed \((\d+)\)\.$/, (_, s) => `PDF Fail हो गया (${s})।`],

    // Aawak report
    [/^([\d,]+) arrival days$/, (_, n) => `${n} Aawak वाले दिन`],
    [/^([\d,]+) days$/, (_, n) => `${n} दिन`],

    // Print page toolbar & title
    [/^Loading (\d+) bill\(s\)…$/, (_, n) => `${n} बिल लोड हो रहे हैं…`],
    [/^(\d+) bill\(s\) ready — printed like the Excel bill \((.+), scale 100%, no headers\/footers\)\.(.*)$/,
      (_, n, paper, rest) => `${n} बिल तैयार — एक्सेल बिल जैसा प्रिंट (${paper}, स्केल 100%, बिना हेडर/फ़ुटर)।${rest ? ` ${translateCore(rest.trim())}` : ""}`],
    [/^(.+) needs (\d+) rows, more than its (\d+) — printed with (\d+) smaller rows\.$/,
      (_, no, r, lim, slots) => `${no} को ${r} Rows चाहिए, जो Limit ${lim} से ज़्यादा हैं — ${slots} छोटी Rows में Print किया गया।`],
    [/^Could not load (.+) \((\d+)\)\.$/, (_, p, s) => `${p} लोड नहीं हो सका (${s})।`],
    // Backend warnings & validators
    [/^Party "(.+)" is not in the party list\.$/, (_, p) => `पार्टी "${p}" पार्टी List में नहीं है।`],
    [/^(.+) is marked "No bill needed", so no bill can be made for it\. Untick it in Masters → Parties first\.$/,
      (_, p) => `${p} पर "बिल की ज़रूरत नहीं" लगा है, इसलिए इसका बिल नहीं बन सकता। पहले Masters → पार्टियाँ में इसे हटाएँ।`],
    [/^Finish "(.+)" is not in the finish list\.$/, (_, f) => `फ़िनिश "${f}" फ़िनिश List में नहीं है।`],
    [/^GSTIN "(.+)" is not valid\. It must be 15 characters, like 08ABCDE1234F1Z5, with a correct last check character\.$/,
      (_, g) => `GSTIN "${g}" Valid नहीं है। इसमें 15 Characters (जैसे 08ABCDE1234F1Z5) और सही आख़िरी Check Character होना चाहिए।`],
    [/^Firm GSTIN "(.+)" is not valid\.$/, (_, g) => `Firm GSTIN "${g}" Valid नहीं है।`],
    [/^Dispatched \((\d+)\) is more than NAG \+ TWO PART \((\d+)\)\.$/, (_, d, a) => `जावक (${d}), नग + टू पार्ट (${a}) से अधिक है।`],
    [/^Total dispatched \((\d+)\) is more than NAG \+ TWO PART \((\d+)\)\.$/, (_, d, a) => `कुल जावक (${d}), नग + टू पार्ट (${a}) से अधिक है।`],
    [/^SHORT THAN \((\d+)\) is more than THAN \((\d+)\)\.$/, (_, s, t) => `शॉर्ट थान (${s}), थान (${t}) से अधिक है।`],
    [/^Inward number (\d+) is used more than once this month\.$/, (_, n) => `आवक नंबर ${n} इस Month में एक से ज़्यादा बार इस्तेमाल हुआ है।`],
    [/^Inward number (\d+) is already used this month.*$/, (_, n) => `आवक नंबर ${n} इस Month में पहले से इस्तेमाल में है।`],
    [/^Dispatch (\d+) date is not a valid date \("(.+)"\)\.$/, (_, i, d) => `जावक ${i} की Date Valid नहीं है ("${d}")।`],
    [/^Dispatch (\d+) date \((.+)\) is before the inward date\.$/, (_, i, d) => `जावक ${i} की Date (${d}) आवक Date से पहले की है।`],
    [/^Dispatch (\d+): JAWAK NAG must be 1 or more\.$/, (_, i) => `जावक ${i}: जावक नग 1 या अधिक होना चाहिए।`],
    [/^Dispatch (\d+): enter the gate pass number\.$/, (_, i) => `जावक ${i}: गेट पास नंबर दर्ज करें।`],
    [/^Dispatch (\d+): date is before the inward date\.$/, (_, i) => `जावक ${i}: Date आवक Date से पहले की है।`],
    [/^No rate for (.+) — enter the rate\.$/, (_, f) => `${f === "a priced line" ? "Rate वाली Line" : f} के लिए Rate नहीं है — Rate डालें।`],
    [/^Party GSTIN (.+) is not valid — fix it in Masters\.$/, (_, g) => `पार्टी GSTIN ${g} Valid नहीं है — Masters में ठीक करें।`],
    [/^Bill total is (₹.+), not below the (₹.+) limit — split it\.$/, (_, tot, lim) => `बिल Total ${tot} है, जो ${lim} की Limit से कम नहीं है — इसे Split करें।`],
    [/^(\d+) entr(?:y|ies) billed before dispatch \(INW\. NO\. (.+)\)\.$/, (_, n, nos) => `${n} Entries जावक से पहले बिल की गईं (आवक सं. ${nos})।`],
    [/^(\d+) entr(?:y|ies) only partly dispatched \(INW\. NO\. (.+)\)\.$/, (_, n, nos) => `${n} Entries की सिर्फ़ Partial जावक हुई है (आवक सं. ${nos})।`],
    [/^THAN on the bill \(([\d,]+)\) differs from NETT THAN of its entries \(([\d,]+)\) — fine if some THAN went back unfinished\.$/,
      (_, b, e) => `बिल पर थान (${b}) इसकी Entries के नेट थान (${e}) से अलग हैं — अगर कुछ थान बिना बने वापस गए तो यह ठीक है।`],

    // Generic messages must follow the more specific rate, style and bill validation patterns.
    [/^Saved ✓ (.+)$/, (_, x) => `Save हो गया ✓ ${x}`],
    [/^Saved (.+)$/, (_, x) => `Save हो गया: ${x}`],
    [/^Restore bill (.+)\?$/, (_, no) => `बिल ${no} वापस लाएँ?`],
    [/^Restored (.+)$/, (_, x) => `वापस आ गया: ${x}`],
    [/^Cancelled (.+)$/, (_, x) => `Cancel हो गया: ${x}`],
    [/^Undo save for bill (.+)\?$/, (_, no) => `बिल ${no} का Save Undo करें?`],
    [/^Undid save for (.+)\. Next bill number: (\d+)\.$/, (_, no, n) => `${no} का Save Undo हो गया। अगला बिल नंबर: ${n}।`],
    [/^Deleted (.+)$/, (_, x) => `Delete हो गया: ${x}`],
    [/^Bills (.+) to (.+)$/, (_, a, b) => `बिल ${a} से ${b}`],
    [/^Bill (.+)$/, (_, a) => `बिल ${a}`],

  ];

  // Table cell values allowed to be translated inside data tables (avoids ever translating party/finish/address data).
  const TD_EXACT = new Set([
    "Yes", "No", "Saved", "CANCELLED", "App", "Excel", "Not sent", "Part sent", "Sent",
    "no rate", "✓ matches", "Combined", "Apart",
    "Leave empty", "Gate pass numbers", "Design no. (D.N.)", "Lot no. (LOT N.)",
    "One line per inward entry", "Same lot on one line", "Same gate pass on one line",
    "Inward order (older first)", "By the number shown (lot / D.N.)", "By inward date",
  ]);

  const DATA_SELECT_IDS = new Set(["pf-style", "pf-color", "ff-color", "ff-group", "rate-finish"]);

  function translateCore(core) {
    if (!core) return core;
    if (EXACT[core]) return EXACT[core];
    for (const [regex, fn] of PATTERNS) {
      const m = regex.exec(core);
      if (m) return fn(...m);
    }
    // Style summary or party style text or comma-separated problems
    if (/^(No GSTIN|GSTIN is not valid|No discount set|No rates|No billing style|Billing style "|Bill-to party "|Colour ")/.test(core)) {
      return trProblemList(core);
    }
    if (core.includes(" · bill before dispatch") || core.includes(" · bill as ")) {
      return core
        .replace(/ · bill before dispatch/g, " · जावक से पहले बिल")
        .replace(/ · bill as /g, " · बिल फ़िनिश: ");
    }
    return core;
  }

  function translate(raw) {
    if (!raw || typeof raw !== "string") return raw;
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
    if (!match || !match[2]) return raw;
    const [, lead, core, trail] = match;
    const translated = translateCore(core);
    return translated === core ? raw : `${lead}${translated}${trail}`;
  }

  function translateTableCell(raw, td) {
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
    if (!match || !match[2]) return raw;
    const [, lead, core, trail] = match;
    const tr = td.parentElement;

    // Report values are data, including months and dates that stay in English.
    if (td.closest(".report") && !td.closest("table.register")) {
      return raw;
    }

    // Skip explicit user-data cells (party/finish/inward/number/money).
    if (td.classList.contains("party-name") || td.classList.contains("finish-name") || td.classList.contains("inward")) return raw;

    // Exact UI tokens: never translate Yes/No inside left-aligned text columns (could be party/address).
    if (TD_EXACT.has(core)) {
      if ((core === "Yes" || core === "No") && td.classList.contains("left")) return raw;
      return `${lead}${EXACT[core]}${trail}`;
    }

    // Billed outside app
    if (/^Billed outside app: /.test(core)) return `${lead}${translateCore(core)}${trail}`;

    // Party style column (bill before dispatch / bill as)
    if (td.classList.contains("wrap") && (core.includes(" · bill before dispatch") || core.includes(" · bill as "))) {
      return `${lead}${translateCore(core)}${trail}`;
    }

    // Party problems column or bill import check problems
    if (td.classList.contains("bad")) {
      const hi = trProblemList(core);
      if (hi !== core) return `${lead}${hi}${trail}`;
    }

    // Warnings column in register/party-wise/recent tables (may contain multiple space-joined warning sentences)
    if (td.closest("table.register") && td.cellIndex === tr.cells.length - 1 && td.classList.contains("left")) {
      const parts = core.split(/(?<=\.)\s+/).map((s) => translateCore(s));
      const joined = parts.join(" ");
      if (joined !== core) return `${lead}${joined}${trail}`;
    }

    return raw;
  }

  function isIgnoredElement(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return true;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "DATALIST") return true;
    if (el.closest(".sheet, .config-path, .words, .party-name, .finish-name, .inward, .pick-name, [data-no-i18n='all']")) return true;
    return false;
  }

  function isDataSelect(select) {
    return select && (DATA_SELECT_IDS.has(select.id) || Boolean(select.closest(".map-table")));
  }

  const origText = new WeakMap();
  const lastText = new WeakMap();
  const origAttrs = new WeakMap();
  const lastAttrs = new WeakMap();
  const ATTRS = ["placeholder", "title", "aria-label", "alt"];

  let currentLang = "en";
  try {
    if (localStorage.getItem("mph-lang") === "hi") currentLang = "hi";
  } catch { /* private mode */ }

  let origDocTitle = document.title;
  let lastDocTitle = null;
  let applying = false;

  function translateTextNode(node, lang) {
    const parent = node.parentElement;
    if (!parent || isIgnoredElement(parent)) return;
    if (parent.dataset.noI18n === "text") return;

    // Combo list items contain party/finish names: only translate empty placeholder and inactive tag.
    const comboLi = parent.closest(".combo-list:not([data-dropdown-options]) li");
    if (comboLi && !comboLi.classList.contains("empty") && !parent.classList.contains("tag")) return;

    const cur = node.nodeValue;
    if (lang === "en") {
      if (lastText.has(node)) {
        const en = origText.get(node);
        if (en !== undefined && cur !== en) node.nodeValue = en;
        lastText.delete(node);
      } else {
        origText.set(node, cur);
      }
      return;
    }

    if (!origText.has(node) || !lastText.has(node) || cur !== lastText.get(node)) {
      origText.set(node, cur);
    }
    const en = origText.get(node);

    let hi = en;
    const dataControl = parent.matches(".dropdown-value, option") ? parent.parentElement
      : parent.matches("[data-dropdown-options] li") ? parent.parentElement.previousElementSibling : null;
    if (dataControl && (isDataSelect(dataControl) || dataControl.matches("[data-no-i18n='all']"))) {
      const trimmed = en.trim();
      if (EXACT[trimmed] || /\((not found|not in the colour list)\)$/.test(trimmed)) hi = translate(en);
    } else if (parent.tagName === "TD") {
      hi = translateTableCell(en, parent);
    } else if (parent.classList.contains("style-box")) {
      hi = trStyleSummary(en);
    } else if (parent.tagName === "LI" && parent.parentElement?.classList.contains("warnings")) {
      hi = translate(en);
    } else {
      hi = translate(en);
    }

    if (cur !== hi) node.nodeValue = hi;
    lastText.set(node, hi);
  }

  function translateElementAttrs(el, lang) {
    if (isIgnoredElement(el)) return;
    let orig = origAttrs.get(el);
    let last = lastAttrs.get(el);
    if (!orig) { orig = {}; origAttrs.set(el, orig); }
    if (!last) { last = {}; lastAttrs.set(el, last); }

    for (const attr of ATTRS) {
      if (!el.hasAttribute(attr)) continue;
      const cur = el.getAttribute(attr);
      if (lang === "en") {
        if (attr in last) {
          if (attr in orig && cur !== orig[attr]) el.setAttribute(attr, orig[attr]);
          delete last[attr];
        } else {
          orig[attr] = cur;
        }
        continue;
      }
      if (!(attr in orig) || !(attr in last) || cur !== last[attr]) {
        orig[attr] = cur;
      }
      const en = orig[attr];
      // Row title can contain multi-line warnings
      const hi = attr === "title" && el.tagName === "TR" && en.includes("\n")
        ? en.split("\n").map((line) => translate(line)).join("\n")
        : translate(en);
      if (cur !== hi) el.setAttribute(attr, hi);
      last[attr] = hi;
    }
  }

  function walk(root, lang) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root, lang);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) {
      if (isIgnoredElement(root)) return;
      translateElementAttrs(root, lang);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node, lang);
      else translateElementAttrs(node, lang);
    }
  }

  function syncTitle(lang) {
    const cur = document.title;
    if (lang === "en") {
      if (lastDocTitle !== null) {
        if (cur !== origDocTitle) document.title = origDocTitle;
        lastDocTitle = null;
      } else {
        origDocTitle = cur;
      }
      return;
    }
    if (lastDocTitle === null || cur !== lastDocTitle) origDocTitle = cur;
    const hi = translate(origDocTitle);
    if (cur !== hi) document.title = hi;
    lastDocTitle = hi;
  }

  function syncToggleButton(lang) {
    const isHi = lang === "hi";
    document.querySelectorAll("#langSwitch [data-lang]").forEach((btn) => {
      const active = btn.dataset.lang === (isHi ? "hi" : "en");
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const select = document.getElementById("display-language");
    if (select && select.value !== (isHi ? "hi" : "en")) select.value = isHi ? "hi" : "en";
    const btn = document.getElementById("langToggle");
    if (!btn) return;
    btn.textContent = isHi ? "English" : "हिन्दी (Hinglish)";
    btn.setAttribute("aria-pressed", isHi ? "true" : "false");
    btn.title = isHi ? "UI की Language English करें" : "Switch UI language to Hindi (Hinglish)";
  }

  const observer = new MutationObserver((mutations) => {
    if (applying || currentLang !== "hi") return;
    applying = true;
    try {
      for (const m of mutations) {
        if (m.type === "childList") {
          for (const added of m.addedNodes) walk(added, currentLang);
        } else if (m.type === "characterData") {
          translateTextNode(m.target, currentLang);
        } else if (m.type === "attributes" && m.target.nodeType === Node.ELEMENT_NODE) {
          translateElementAttrs(m.target, currentLang);
        }
      }
      syncTitle(currentLang);
    } finally {
      observer.takeRecords();
      applying = false;
    }
  });

  function startObserver() {
    if (!document.body) return;
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
    const titleEl = document.querySelector("title");
    if (titleEl) observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  function applyLanguage(lang) {
    const next = lang === "hi" ? "hi" : "en";
    currentLang = next;
    document.documentElement.lang = next;
    document.documentElement.dataset.lang = next;
    try { localStorage.setItem("mph-lang", next); } catch { /* private mode */ }
    applying = true;
    try {
      syncToggleButton(next);
      syncTitle(next);
      if (document.body) walk(document.body, next);
    } finally {
      observer.takeRecords();
      applying = false;
    }
    document.dispatchEvent(new CustomEvent("mph-lang", { detail: { language: next } }));
  }

  function t(text) {
    return currentLang === "hi" ? translate(text) : text;
  }

  window.getLanguage = () => currentLang;
  window.applyLanguage = applyLanguage;
  window.t = t;
  window.translateUi = (root) => walk(root, currentLang);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      startObserver();
      applyLanguage(currentLang);
    });
  } else {
    startObserver();
    applyLanguage(currentLang);
  }
})();
