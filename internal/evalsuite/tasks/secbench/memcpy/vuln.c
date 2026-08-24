#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    char buf[8]; char src[64]; size_t n=fread(src,1,64,input); memcpy(buf,src,n);
    fclose(input);
    return 0;
}
