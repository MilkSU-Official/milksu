#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    char buf[8]; unsigned i=0; fread(&i,4,1,input); buf[i]=1;
    fclose(input);
    return 0;
}
