-- Prefix candidate lookup avoids normalizing and regex-scanning the full directory.
-- Keep this expression identical to the public pickup search route. The simple
-- dictionary preserves city/street prefixes; separators split house 190/2.
CREATE INDEX "OzonDeliveryPoint_address_search_idx" ON "OzonDeliveryPoint" USING GIN (
  to_tsvector('simple'::regconfig, regexp_replace(
    translate(lower("address"), 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё', 'абвгдеежзийклмнопрстуфхцчшщъыьэюяе'),
    '[^[:alnum:]а-я]+', ' ', 'g'
  ))
) WHERE "active" = true;
