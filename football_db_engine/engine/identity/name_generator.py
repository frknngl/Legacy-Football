import hashlib
import random
import re

class GameNameGenerator:
    """
    Generates license-safe game names from real names deterministically.
    E.g. Bruno Fernandes -> Bruno Fernandoes
    """
    
    def __init__(self):
        # We use consistent mapping rules seeded by the player's name
        self.vowels = list("aeiou")
        self.consonants = list("bcdfghjklmnpqrstvwxyz")
        
    def _get_seed(self, name: str) -> int:
        return int(hashlib.md5(name.encode('utf-8')).hexdigest(), 16)

    def generate_name(self, real_name: str) -> str:
        """
        Generates a fake name by slightly mutating the last name.
        """
        if not real_name:
            return real_name
            
        parts = real_name.split(" ")
        if len(parts) == 1:
            return self._mutate_word(parts[0], self._get_seed(real_name))
            
        # Mutate only the last part of the name
        last_name = parts[-1]
        mutated_last_name = self._mutate_word(last_name, self._get_seed(real_name))
        
        parts[-1] = mutated_last_name
        return " ".join(parts)
        
    def _mutate_word(self, word: str, seed: int) -> str:
        random.seed(seed)
        
        # Don't mutate very short words
        if len(word) <= 3:
            return word
            
        word_lower = word.lower()
        chars = list(word_lower)
        
        # Strategy: Pick a random vowel and change it to another vowel, 
        # or pick a consonant and change it to a phonetically similar one.
        strategy = random.choice(['vowel', 'consonant', 'suffix'])
        
        if strategy == 'vowel':
            vowel_indices = [i for i, c in enumerate(chars) if c in self.vowels]
            if vowel_indices:
                idx = random.choice(vowel_indices)
                old_vowel = chars[idx]
                new_vowel = random.choice([v for v in self.vowels if v != old_vowel])
                chars[idx] = new_vowel
        elif strategy == 'suffix':
            if chars[-1] in self.vowels:
                chars[-1] = random.choice([v for v in self.vowels if v != chars[-1]])
            else:
                chars.append(random.choice(['s', 'o', 'a', 'i', 'e']))
        else:
            cons_indices = [i for i, c in enumerate(chars) if c in self.consonants]
            if cons_indices:
                idx = random.choice(cons_indices)
                # Just change it to something somewhat similar or random consonant
                chars[idx] = random.choice(self.consonants)
                
        mutated = "".join(chars)
        
        # Restore capitalization
        if word.istitle():
            return mutated.title()
        elif word.isupper():
            return mutated.upper()
        return mutated

if __name__ == "__main__":
    gen = GameNameGenerator()
    print("Bruno Fernandes ->", gen.generate_name("Bruno Fernandes"))
    print("Leroy Sané ->", gen.generate_name("Leroy Sané"))
    print("Lionel Messi ->", gen.generate_name("Lionel Messi"))
    print("Cristiano Ronaldo ->", gen.generate_name("Cristiano Ronaldo"))
    print("Real Madrid ->", gen.generate_name("Real Madrid"))
