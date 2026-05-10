delete from vocab_variant_cache
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by word_key, part_of_speech_key
        order by updated_at desc, confidence desc nulls last, created_at desc
      ) as duplicate_rank
    from vocab_variant_cache
  ) ranked
  where duplicate_rank > 1
);

alter table vocab_variant_cache
  drop constraint if exists vocab_variant_cache_word_key_part_of_speech_key_relation_type_key;

create unique index if not exists idx_vocab_variant_cache_word_pos_unique
  on vocab_variant_cache(word_key, part_of_speech_key);
