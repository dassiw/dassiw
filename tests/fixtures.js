// Sample responses shaped after the documented krdict search fields (not real captures).
const head = '<?xml version="1.0" encoding="UTF-8" ?><channel><title>t</title><link>https://krdict.korean.go.kr</link><description>d</description><lastBuildDate>20261107</lastBuildDate>';
const sense = (n, def, tw, td) => `<sense><sense_order>${n}</sense_order><definition>${def}</definition><translation><trans_lang>영어</trans_lang><trans_word><![CDATA[${tw}]]></trans_word><trans_dfn><![CDATA[${td}]]></trans_dfn></translation></sense>`;
exports.XML_SCHOOL = head + '<total>2</total><start>1</start><num>10</num>' +
  '<item><target_code>100</target_code><word>학교</word><sup_no>0</sup_no><origin>學校</origin><pronunciation>학꾜</pronunciation><word_grade>초급</word_grade><pos>명사</pos><link>https://krdict.korean.go.kr/dicSearch/SearchView?ParaWordNo=100</link>' +
  sense(1, "교사가 학생을 가르치는 기관.", "school", "An institution where teachers teach students.") + sense(2, "수업을 하는 일.", "school; class", "Teaching.") + '</item>' +
  '<item><target_code>101</target_code><word>학교</word><sup_no>1</sup_no><word_grade>없음</word_grade><pos>명사</pos><link>https://evil.example.com/x</link>' + sense(1, "다른 뜻.", "other", "Other.") + '</item></channel>';
exports.XML_EMPTY = head + '<total>0</total><start>1</start><num>10</num></channel>';
exports.XML_ERR = '<?xml version="1.0" encoding="UTF-8" ?><error><error_code>020</error_code><message>Unregistered key</message></error>';
